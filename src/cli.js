import { Workspace } from './storage/workspace.js';
import { Collective } from './collective/collective.js';
import { ProviderRegistry } from './providers/registry.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { AuthEngine } from './authorization/auth-engine.js';
import { ApprovalFlow } from './authorization/approval-flow.js';
import { ToolExecutor } from './runtime/tool-executor.js';
import { AgentRuntime } from './runtime/agent-runtime.js';
import { SessionStore } from './session/session-store.js';
import { Repl } from './repl/repl.js';
import { formatInfo, formatError, formatSuccess, formatParticipant } from './repl/display.js';
import { ActivityLogger } from './repl/activity-logger.js';
import { createUrAgentConfig } from './templates/ur-agent.js';
import { createResourceAgentConfig } from './templates/resource-agent.js';
import { PendingApprovalStore } from './authorization/pending-approval-store.js';

// Tool imports
import { CommunicatorTool } from './tools/builtin/communicator-tool.js';
import { SpawnAgentTool } from './tools/builtin/spawn-agent-tool.js';
import { ModifyAgentTool } from './tools/builtin/modify-agent-tool.js';
import { RetireAgentTool } from './tools/builtin/retire-agent-tool.js';
import { ListParticipantsTool } from './tools/builtin/list-participants-tool.js';
import { ListToolsTool } from './tools/builtin/list-tools-tool.js';
import { ResolveApprovalTool } from './tools/builtin/resolve-approval-tool.js';
import { FileReadTool } from './tools/builtin/file-read-tool.js';
import { FileWriteTool } from './tools/builtin/file-write-tool.js';
import { FileListTool } from './tools/builtin/file-list-tool.js';
import { FileDeleteTool } from './tools/builtin/file-delete-tool.js';

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
    /** @type {Object} */
    const info = {
      id: p.id,
      name: p.name,
      type: p.type,
      description: p.description,
    };
    if (p.type === 'agent') {
      const agent = /** @type {import('./collective/agent.js').Agent} */ (p);
      info.model = `${agent.modelConfig.provider}/${agent.modelConfig.model}`;
      info.tools = agent.tools;
    }
    console.log(formatParticipant(info));
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
  const sessionStore = new SessionStore(workspace);
  const runId = await sessionStore.createRun(collective.getConfig().id);
  const repl = new Repl();
  const pendingApprovalStore = new PendingApprovalStore();

  // Create tool instances
  const communicatorTool = new CommunicatorTool({
    collective,
    sessionStore,
    repl,
    runId,
    authEngine,
    pendingApprovalStore,
    activityLogger,
    agentRuntime,
  });

  // Register all tools
  toolRegistry.registerTool(communicatorTool);
  toolRegistry.registerTool(new SpawnAgentTool({ collective, activityLogger }));
  toolRegistry.registerTool(new ListParticipantsTool({ collective }));
  toolRegistry.registerTool(new ModifyAgentTool({ collective, activityLogger }));
  toolRegistry.registerTool(new RetireAgentTool({ collective, activityLogger }));
  toolRegistry.registerTool(new FileReadTool({ rootDir: cwd }));
  toolRegistry.registerTool(new FileWriteTool({ rootDir: cwd }));
  toolRegistry.registerTool(new FileListTool({ rootDir: cwd }));
  toolRegistry.registerTool(new FileDeleteTool({ rootDir: cwd }));
  toolRegistry.registerTool(new ResolveApprovalTool({ pendingApprovalStore, activityLogger }));
  // list_tools must be last so it can see all other tools
  toolRegistry.registerTool(new ListToolsTool({ toolRegistry }));

  // Wire approval flow
  const approvalFlow = new ApprovalFlow({ collective, repl, activityLogger });
  toolExecutor.setApprovalFlow(approvalFlow);

  // Start REPL
  repl.start();

  console.log(formatSuccess(`\nLegion — Many as One`));
  console.log(formatInfo(`Run: ${runId}`));
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
      await handleCommand(input, { collective, repl });
      return;
    }

    try {
      const response = await communicatorTool.execute(
        { targetId: 'ur-agent', message: input },
        { callerId: user.id }
      );
      repl.displayMessage('UR Agent', response);
    } catch (err) {
      repl.displayError(err.message);
    }
  });

  // Clean up
  await sessionStore.endRun(runId);
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
