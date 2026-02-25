import { Workspace } from './storage/workspace.js';
import { Collective } from './collective/collective.js';
import { ProviderRegistry } from './providers/registry.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { AuthEngine } from './authorization/auth-engine.js';
import { ApprovalFlow } from './authorization/approval-flow.js';
import { ToolExecutor } from './runtime/tool-executor.js';
import { AgentRuntime } from './runtime/agent-runtime.js';
import { SessionManager } from './communication/session-manager.js';
import { Communicator } from './communication/communicator.js';
import { Repl } from './repl/repl.js';
import { formatInfo, formatError, formatSuccess, formatParticipant } from './repl/display.js';
import { ActivityLogger } from './repl/activity-logger.js';
import { createUrAgentConfig } from './templates/ur-agent.js';
import { createResourceAgentConfig } from './templates/resource-agent.js';
import { COMMUNICATOR_DEFINITION } from './tools/builtin/communicator-tool.js';
import { SPAWN_AGENT_DEFINITION, createSpawnAgentHandler } from './tools/builtin/spawn-agent-tool.js';
import { LIST_PARTICIPANTS_DEFINITION, createListParticipantsHandler } from './tools/builtin/list-participants-tool.js';
import { MODIFY_AGENT_DEFINITION, createModifyAgentHandler } from './tools/builtin/modify-agent-tool.js';
import { RETIRE_AGENT_DEFINITION, createRetireAgentHandler } from './tools/builtin/retire-agent-tool.js';
import {
  FILE_READ_DEFINITION, createFileReadHandler,
  FILE_WRITE_DEFINITION, createFileWriteHandler,
  FILE_LIST_DEFINITION, createFileListHandler,
  FILE_DELETE_DEFINITION, createFileDeleteHandler,
} from './tools/builtin/file-tools.js';
import { LIST_TOOLS_DEFINITION, createListToolsHandler } from './tools/builtin/list-tools-tool.js';

/**
 * Parse CLI arguments and dispatch.
 * @param {string[]} argv
 */
export async function run(argv) {
  const command = argv[0];

  switch (command) {
    case 'init':
      await handleInit(parseFlags(argv.slice(1)));
      break;
    case 'start':
      await handleStart(parseFlags(argv.slice(1)));
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      if (!command) {
        printHelp();
      } else {
        console.error(formatError(`Unknown command: ${command}`));
        printHelp();
        process.exit(1);
      }
  }
}

/**
 * Handle `legion init` command.
 * @param {Object} options
 */
async function handleInit(options) {
  const cwd = process.cwd();
  const workspace = new Workspace(cwd);

  if (await workspace.exists()) {
    console.error(formatError('.legion/ already exists in this directory.'));
    process.exit(1);
  }

  const name = options.name || 'My Collective';
  const userName = options.user || 'User';

  await workspace.initialize();

  const collective = new Collective(workspace);
  await collective.initialize({
    name,
    userName,
    defaultAgents: [
      createUrAgentConfig(),
      createResourceAgentConfig(),
    ],
  });

  console.log(formatSuccess(`Initialized Legion collective "${name}" at .legion/`));
  console.log(formatInfo('Created participants:'));
  for (const p of collective.getAllParticipants()) {
    console.log(formatParticipant({
      id: p.id,
      name: p.name,
      type: p.type,
      description: p.description,
      model: p.type === 'agent' ? `${p.modelConfig.provider}/${p.modelConfig.model}` : undefined,
      tools: p.type === 'agent' ? p.tools : undefined,
    }));
  }
}

/**
 * Handle `legion start` command.
 * @param {Object} options
 */
async function handleStart(options) {
  const cwd = process.cwd();
  const workspace = new Workspace(cwd);

  if (!await workspace.exists()) {
    console.error(formatError('No .legion/ found. Run `legion init` first.'));
    process.exit(1);
  }

  // Build dependency graph
  const providerRegistry = ProviderRegistry.createDefault();
  const availableProviders = providerRegistry.listProviders();
  if (availableProviders.length === 0) {
    console.error(formatError(
      'No LLM provider API keys found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.'
    ));
    process.exit(1);
  }

  const collective = new Collective(workspace);
  await collective.load();

  const activityLogger = new ActivityLogger();
  const toolRegistry = new ToolRegistry();
  const authEngine = new AuthEngine({ collective });
  const toolExecutor = new ToolExecutor({ toolRegistry, authEngine });
  const agentRuntime = new AgentRuntime({ providerRegistry, toolExecutor, toolRegistry, activityLogger });
  const sessionManager = new SessionManager(workspace);
  const sessionId = await sessionManager.createSession(collective.getConfig().id);
  const repl = new Repl();

  const communicator = new Communicator({
    collective,
    sessionManager,
    agentRuntime,
    repl,
    sessionId,
    activityLogger,
    authEngine,
  });

  // Wire communicator tool handler
  toolRegistry.register(
    'communicator',
    COMMUNICATOR_DEFINITION,
    async (input, context) => {
      return communicator.send({
        senderId: context.callerId,
        targetId: input.targetId,
        message: input.message,
        sessionName: input.sessionName || 'default',
        activeConversationId: context.activeConversationId,
        parentSuspensionHandler: context.suspensionHandler,
      });
    }
  );

  // Register other built-in tools
  toolRegistry.register(
    'spawn_agent',
    SPAWN_AGENT_DEFINITION,
    createSpawnAgentHandler(collective, { activityLogger })
  );

  toolRegistry.register(
    'list_participants',
    LIST_PARTICIPANTS_DEFINITION,
    createListParticipantsHandler(collective)
  );

  toolRegistry.register(
    'modify_agent',
    MODIFY_AGENT_DEFINITION,
    createModifyAgentHandler(collective, { activityLogger })
  );

  toolRegistry.register(
    'retire_agent',
    RETIRE_AGENT_DEFINITION,
    createRetireAgentHandler(collective, { activityLogger })
  );

  // Register file I/O tools
  toolRegistry.register(
    'file_read',
    FILE_READ_DEFINITION,
    createFileReadHandler(cwd)
  );

  toolRegistry.register(
    'file_write',
    FILE_WRITE_DEFINITION,
    createFileWriteHandler(cwd)
  );

  toolRegistry.register(
    'file_list',
    FILE_LIST_DEFINITION,
    createFileListHandler(cwd)
  );

  toolRegistry.register(
    'file_delete',
    FILE_DELETE_DEFINITION,
    createFileDeleteHandler(cwd)
  );

  // Register list_tools — must be after all other tools so it can see them all
  toolRegistry.register(
    'list_tools',
    LIST_TOOLS_DEFINITION,
    createListToolsHandler(toolRegistry)
  );

  // Wire approval flow — no longer needs communicator (approval flows as tool_results)
  const approvalFlow = new ApprovalFlow({ collective, repl, activityLogger });
  toolExecutor.setApprovalFlow(approvalFlow);

  // Start REPL
  repl.start();

  console.log(formatSuccess(`\nLegion — Many as One`));
  console.log(formatInfo(`Session: ${sessionId}`));
  console.log(formatInfo(`Providers: ${availableProviders.join(', ')}`));
  console.log(formatInfo(`Participants: ${collective.getAllParticipants().map(p => p.name).join(', ')}`));
  console.log(formatInfo(`\nType a message to talk to the UR Agent, or /help for commands.\n`));

  // Find the user participant
  const user = collective.getAllParticipants().find(p => p.type === 'user');
  if (!user) {
    console.error(formatError('No user participant found in collective.'));
    process.exit(1);
  }

  // Main input loop
  await repl.inputLoop(async (input) => {
    // Handle commands
    if (input.startsWith('/')) {
      await handleCommand(input, { collective, sessionManager, repl, sessionId });
      return;
    }

    try {
      const response = await communicator.send({
        senderId: user.id,
        targetId: 'ur-agent',
        message: input,
      });
      repl.displayMessage('UR Agent', response);
    } catch (err) {
      repl.displayError(err.message);
    }
  });

  // Clean up
  await sessionManager.endSession(sessionId);
  repl.stop();
  console.log(formatInfo('\nSession ended. Goodbye!'));
}

/**
 * Handle REPL commands.
 * @param {string} input
 * @param {Object} deps
 */
async function handleCommand(input, { collective, repl }) {
  const parts = input.split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case '/help':
      console.log(formatInfo([
        'Commands:',
        '  /help          — Show this help message',
        '  /participants  — List all participants in the collective',
        '  /quit          — End the session and exit',
      ].join('\n')));
      break;

    case '/participants':
      for (const p of collective.getAllParticipants()) {
        console.log(formatParticipant({
          id: p.id,
          name: p.name,
          type: p.type,
          description: p.description,
          model: p.type === 'agent' ? `${p.modelConfig.provider}/${p.modelConfig.model}` : undefined,
          tools: p.type === 'agent' ? p.tools : undefined,
        }));
      }
      break;

    default:
      console.log(formatInfo(`Unknown command: ${cmd}. Type /help for available commands.`));
  }
}

/**
 * Parse simple --flag value pairs from argv.
 * @param {string[]} argv
 * @returns {Object}
 */
function parseFlags(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      result[key] = value;
    }
  }
  return result;
}

function printHelp() {
  console.log(`
Legion — A Persistent Multi-Agent Collective

Usage:
  legion init [--name <name>] [--user <username>]
    Initialize a new collective in the current directory.

  legion start
    Start a session with the collective.

  legion help
    Show this help message.
`);
}
