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

  // Resume latest run or create a new one
  const latestRun = await sessionStore.getLatestRun();
  let runId;
  let resumed = false;
  if (latestRun) {
    runId = await sessionStore.resumeRun(latestRun.id);
    resumed = true;
  } else {
    runId = await sessionStore.createRun(collective.getConfig().id);
  }

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

  // Mutable context shared between input loop and command handler
  const ctx = { currentRunId: runId };

  // Start REPL
  repl.start();

  console.log(formatSuccess(`\nLegion — Many as One`));
  if (resumed) {
    const runLabel = latestRun.name ? `${latestRun.name} (${runId.slice(0, 8)})` : runId.slice(0, 8);
    console.log(formatInfo(`Resumed session: ${runLabel}`));
  } else {
    console.log(formatInfo(`New session: ${runId.slice(0, 8)}`));
  }
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
      await handleCommand(input, { collective, repl, sessionStore, communicatorTool, ctx });
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
  await sessionStore.endRun(ctx.currentRunId);
  repl.stop();
  console.log(formatInfo('\nSession ended. Goodbye!'));
}

/**
 * Handle REPL commands.
 * @param {string} input
 * @param {Object} deps
 */
async function handleCommand(input, { collective, repl, sessionStore, communicatorTool, ctx }) {
  const parts = input.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const cmd = parts[0];

  switch (cmd) {
    case '/help':
      console.log(formatInfo([
        'Commands:',
        '  /help                  — Show this help message',
        '  /participants          — List all participants in the collective',
        '  /session new [name]    — Start a new session (optional name)',
        '  /session list          — List all sessions',
        '  /session load <id>     — Switch to an existing session (supports partial ID)',
        '  /session info          — Show current session details',
        '  /quit                  — End the session and exit',
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

    case '/session':
      await handleSessionCommand(parts.slice(1), { collective, sessionStore, communicatorTool, ctx });
      break;

    default:
      console.log(formatInfo(`Unknown command: ${cmd}. Type /help for available commands.`));
  }
}

/**
 * Handle /session subcommands.
 * @param {string[]} args
 * @param {Object} deps
 */
async function handleSessionCommand(args, { collective, sessionStore, communicatorTool, ctx }) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'new': {
      // Parse optional name — strip surrounding quotes if present
      const rawName = args.slice(1).join(' ');
      const name = rawName.replace(/^"|"$/g, '') || null;

      await sessionStore.endRun(ctx.currentRunId);
      const collectiveId = collective.getConfig().id;
      const newRunId = await sessionStore.createRun(collectiveId, name);
      ctx.currentRunId = newRunId;
      communicatorTool.setRunId(newRunId);

      const label = name ? `${name} (${newRunId.slice(0, 8)})` : newRunId.slice(0, 8);
      console.log(formatSuccess(`Started new session: ${label}`));
      break;
    }

    case 'list': {
      const runs = await sessionStore.listRuns();
      if (runs.length === 0) {
        console.log(formatInfo('No sessions found.'));
        break;
      }
      console.log(formatInfo('Sessions:'));
      for (const run of runs) {
        const isCurrent = run.id === ctx.currentRunId;
        const marker = isCurrent ? ' (active)' : '';
        const status = run.endedAt ? 'ended' : 'open';
        const name = run.name ? ` "${run.name}"` : '';
        const date = new Date(run.createdAt).toLocaleString();
        const sessions = run.sessionIds?.length || 0;
        console.log(formatInfo(
          `  ${run.id.slice(0, 8)}${name}  ${date}  [${sessions} conversations, ${status}]${marker}`
        ));
      }
      break;
    }

    case 'load': {
      const idPrefix = args[1];
      if (!idPrefix) {
        console.log(formatError('Usage: /session load <id>'));
        break;
      }

      try {
        const targetRun = await sessionStore.findRun(idPrefix);
        if (!targetRun) {
          console.log(formatError(`No session found matching "${idPrefix}".`));
          break;
        }
        if (targetRun.id === ctx.currentRunId) {
          console.log(formatInfo('That session is already active.'));
          break;
        }

        await sessionStore.endRun(ctx.currentRunId);
        await sessionStore.resumeRun(targetRun.id);
        ctx.currentRunId = targetRun.id;
        communicatorTool.setRunId(targetRun.id);

        const label = targetRun.name
          ? `${targetRun.name} (${targetRun.id.slice(0, 8)})`
          : targetRun.id.slice(0, 8);
        console.log(formatSuccess(`Switched to session: ${label}`));
      } catch (err) {
        console.log(formatError(err.message));
      }
      break;
    }

    case 'info': {
      const run = await sessionStore.findRun(ctx.currentRunId);
      if (!run) {
        console.log(formatError('Current session not found.'));
        break;
      }
      console.log(formatInfo('Current session:'));
      console.log(formatInfo(`  ID:       ${run.id}`));
      if (run.name) {
        console.log(formatInfo(`  Name:     ${run.name}`));
      }
      console.log(formatInfo(`  Created:  ${new Date(run.createdAt).toLocaleString()}`));
      console.log(formatInfo(`  Status:   ${run.endedAt ? 'ended' : 'active'}`));
      if (run.sessionIds && run.sessionIds.length > 0) {
        console.log(formatInfo(`  Conversations:`));
        for (const sid of run.sessionIds) {
          // Parse session ID: session-{initiator}__{responder}__{name}
          const match = sid.match(/^session-(.+?)__(.+?)__(.+)$/);
          if (match) {
            console.log(formatInfo(`    ${match[1]} → ${match[2]} (${match[3]})`));
          } else {
            console.log(formatInfo(`    ${sid}`));
          }
        }
      } else {
        console.log(formatInfo(`  Conversations: none yet`));
      }
      break;
    }

    default:
      console.log(formatInfo(
        'Usage: /session <new|list|load|info>\n' +
        '  /session new [name]    — Start a new session\n' +
        '  /session list          — List all sessions\n' +
        '  /session load <id>     — Switch to an existing session\n' +
        '  /session info          — Show current session details'
      ));
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
    Start or resume a session with the collective.

  legion help
    Show this help message.
`);
}
