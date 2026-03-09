import { createInterface, type Interface } from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import type { Workspace } from '@legion-collective/core';
import { Session, AuthEngine, AgentRuntime, MockRuntime, ProcessRegistry, ApprovalLog } from '@legion-collective/core';
import type { RuntimeContext } from '@legion-collective/core';
import { REPLRuntime } from './REPLRuntime.js';
import { registerEventHandlers } from './display.js';
import { createCLIApprovalHandler } from '../approval/ApprovalPrompt.js';

/**
 * REPL — interactive Read-Eval-Print Loop.
 *
 * Provides a terminal-based interface where the user types messages
 * that are dispatched through the Session/Conversation system.
 *
 * Tracks a "current target" agent and an optional conversation name.
 * Messages typed at the prompt go to that target. Use slash commands
 * to switch targets or start named conversations.
 */
export class REPL {
  private workspace: Workspace;
  private session: Session | null = null;
  private rl: Interface | null = null;
  private sessionName?: string;
  private authEngine: AuthEngine;
  private processRegistry: ProcessRegistry | null = null;

  /** The participant ID that bare messages are sent to */
  private currentTarget: string = 'ur-agent';
  /** Optional conversation name (for parallel workstreams) */
  private currentConversation: string | undefined;
  /** The currently active ora spinner (if any), so REPLRuntime can pause it */
  private activeSpinner: ReturnType<typeof ora> | null = null;

  constructor(
    workspace: Workspace,
    options?: { sessionName?: string },
  ) {
    this.workspace = workspace;
    this.sessionName = options?.sessionName;
    const approvalLog = new ApprovalLog(workspace.storage.scope('sessions'));
    this.authEngine = new AuthEngine({ approvalLog });
    this.authEngine.setApprovalHandler(createCLIApprovalHandler());
  }

  /**
   * Resolve the default target agent from config or collective.
   */
  private resolveDefaultTarget(): string {
    // 1. Workspace/global config
    const configured = this.workspace.config.get('defaultAgent');
    if (configured && this.workspace.collective.has(configured)) {
      return configured;
    }

    // 2. ur-agent if it exists
    if (this.workspace.collective.has('ur-agent')) {
      return 'ur-agent';
    }

    // 3. First active agent in the collective
    const agents = this.workspace.collective.list({ type: 'agent', status: 'active' });
    if (agents.length > 0) {
      return agents[0].id;
    }

    return 'ur-agent'; // will produce a clear error when actually used
  }

  /**
   * Build the prompt string showing who you're talking to.
   * Includes a background process count indicator when processes are running.
   */
  private buildPrompt(): string {
    const target = chalk.dim(`[→ ${this.currentTarget}`);
    const convo = this.currentConversation
      ? chalk.dim(` (${this.currentConversation})`)
      : '';
    const bgCount = this.processRegistry?.runningCount() ?? 0;
    const bgIndicator = bgCount > 0
      ? chalk.magenta(` [${bgCount} bg]`)
      : '';
    return `${target}${convo}${chalk.dim(']')}${bgIndicator} ${chalk.green('you> ')}`;
  }

  /**
   * Start the REPL loop.
   */
  async start(): Promise<void> {
    // Register the REPL runtime for user participants
    const replRuntime = new REPLRuntime();
    const factory = () => replRuntime;
    this.workspace.runtimeRegistry.register('user', factory);
    this.workspace.runtimeRegistry.register('user:cli', factory);

    // Register agent and mock runtimes
    this.workspace.runtimeRegistry.register('agent', () => new AgentRuntime());
    this.workspace.runtimeRegistry.register('mock', () => new MockRuntime());

    // Create session-scoped ProcessRegistry and wire it into tools
    this.processRegistry = new ProcessRegistry();
    ProcessRegistry.setInstance(this.processRegistry);

    // Wire up event handlers for display
    registerEventHandlers(this.workspace.eventBus);

    // Resolve default target
    this.currentTarget = this.resolveDefaultTarget();

    // Create or resume session
    const sessionName =
      this.sessionName ?? `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;

    this.session = Session.create(
      sessionName,
      this.workspace.storage,
      this.workspace.runtimeRegistry,
      this.workspace.collective,
      this.workspace.eventBus,
    );

    console.log(chalk.bold.blue('🏛  Legion Interactive Session'));
    console.log(chalk.dim(`   Session:  ${sessionName}`));
    console.log(chalk.dim(`   Target:   ${this.currentTarget}`));
    console.log(chalk.dim('   Type /help for commands, /quit to exit'));
    console.log();

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Give the REPL runtime callbacks so all readline management
    // stays here in the REPL class.  REPLRuntime never touches
    // readline directly — it just calls back to us.
    replRuntime.setPromptHandler((question) => this.promptUser(question));
    replRuntime.setSpinnerGetter(() => this.activeSpinner);

    this.rl.setPrompt(this.buildPrompt());
    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        this.rl?.prompt();
        return;
      }

      // Pause readline while processing to prevent stdin from
      // draining and triggering a premature 'close' event
      this.rl?.pause();

      try {
        // Handle slash commands
        if (trimmed.startsWith('/')) {
          await this.handleCommand(trimmed);
          this.rl?.setPrompt(this.buildPrompt());
        } else {
          // Send to the current target agent
          await this.sendMessage(this.currentTarget, trimmed, this.currentConversation);
        }
      } finally {
        this.rl?.resume();
        this.rl?.prompt();
      }
    });

    this.rl.on('close', async () => {
      await this.cleanup();
      console.log(chalk.dim('\nSession ended.'));
      process.exit(0);
    });
  }

  /**
   * Send a message to a participant and display the response.
   */
  private async sendMessage(
    targetId: string,
    message: string,
    conversationName?: string,
  ): Promise<void> {
    if (!this.workspace.collective.has(targetId)) {
      console.log(chalk.red(`✗ Unknown participant: ${targetId}`));
      console.log(chalk.dim('  Use /collective to see available participants.'));
      console.log();
      return;
    }

    const spinner = ora({
      text: chalk.dim(`Sending to ${targetId}...`),
      spinner: 'dots',
    }).start();
    this.activeSpinner = spinner;

    try {
      const result = await this.session!.send(
        'user',
        targetId,
        message,
        conversationName,
        this.createContext(),
      );
      spinner.stop();
      if (result.response) {
        console.log(chalk.cyan(`${targetId}> `) + result.response);
      } else if (result.error) {
        console.log(chalk.red(`Error: ${result.error}`));
      }
    } catch (error) {
      spinner.stop();
      const msg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`Error: ${msg}`));
    } finally {
      this.activeSpinner = null;
    }

    console.log();
  }

  /**
   * Handle slash commands.
   */
  private async handleCommand(input: string): Promise<void> {
    const [command, ...args] = input.slice(1).split(/\s+/);

    switch (command) {
      case 'help':
        console.log(chalk.bold('\nCommands:'));
        console.log(chalk.dim('  General'));
        console.log('  /help                    — Show this help');
        console.log('  /quit                    — Exit the session');
        console.log();
        console.log(chalk.dim('  Conversation'));
        console.log('  /agent [id]              — Show or switch the target agent');
        console.log('  /convo [name]            — Show or switch the conversation name');
        console.log('  /convo clear             — Clear conversation name (use default)');
        console.log('  /send <id> <msg>         — One-off message to a specific participant');
        console.log('  /conversations           — List conversations in the current session');
        console.log('  /history [n]             — Show last n messages (default 20)');
        console.log();
        console.log(chalk.dim('  Collective & Tools'));
        console.log('  /collective              — List participants');
        console.log('  /session                 — Show session info');
        console.log('  /tools                   — List tools available to the current target');
        console.log();
        console.log(chalk.dim('  Processes'));
        console.log('  /ps                      — List tracked processes');
        console.log('  /output <id> [lines]     — Show recent output from a process');
        console.log('  /kill <id>               — Stop a background process');
        console.log();
        console.log(chalk.dim('  Authorization'));
        console.log('  /approvals [n]           — Show recent approval decisions (default 10)');
        console.log();
        break;

      case 'quit':
      case 'exit':
        await this.cleanup();
        console.log(chalk.dim('Session ended.'));
        process.exit(0);

      case 'agent': {
        if (args.length === 0) {
          // Show current target
          const participant = this.workspace.collective.get(this.currentTarget);
          const name = participant?.name ?? this.currentTarget;
          console.log(`\n  Current target: ${chalk.cyan(this.currentTarget)} (${name})`);
          console.log(chalk.dim('  Use /agent <id> to switch.'));
          console.log();
          break;
        }
        const newTarget = args[0];
        if (!this.workspace.collective.has(newTarget)) {
          console.log(chalk.red(`\n  ✗ Unknown participant: ${newTarget}`));
          const available = this.workspace.collective
            .list({ status: 'active' })
            .map((p) => p.id);
          console.log(chalk.dim(`  Available: ${available.join(', ')}`));
          console.log();
          break;
        }
        this.currentTarget = newTarget;
        const participant = this.workspace.collective.get(newTarget);
        console.log(
          chalk.green(`\n  ✓ Now talking to ${chalk.cyan(newTarget)}`) +
            chalk.dim(` (${participant?.name ?? newTarget})`),
        );
        console.log();
        break;
      }

      case 'convo': {
        if (args.length === 0) {
          // Show current conversation name
          const name = this.currentConversation ?? '(default)';
          console.log(`\n  Current conversation: ${chalk.cyan(name)}`);
          console.log(chalk.dim('  Use /convo <name> to start or switch to a named conversation.'));
          console.log(chalk.dim('  Use /convo clear to go back to the default conversation.'));
          console.log();
          break;
        }
        if (args[0] === 'clear') {
          this.currentConversation = undefined;
          console.log(chalk.green('\n  ✓ Switched to default conversation.'));
          console.log();
          break;
        }
        this.currentConversation = args.join('-');
        console.log(
          chalk.green(`\n  ✓ Conversation set to ${chalk.cyan(this.currentConversation)}`),
        );
        console.log();
        break;
      }

      case 'collective': {
        const participants = this.workspace.collective.list();
        console.log(chalk.bold(`\nCollective (${participants.length}):`));
        for (const p of participants) {
          const marker = p.id === this.currentTarget ? chalk.green(' ← current') : '';
          const status = p.status === 'retired' ? chalk.red(' (retired)') : '';
          console.log(`  ${chalk.cyan(p.id)} — ${p.name} [${p.type}]${status}${marker}`);
        }
        console.log();
        break;
      }

      case 'session': {
        if (this.session) {
          const convos = this.session.listConversations();
          console.log(chalk.bold(`\nSession: ${this.session.data.id}`));
          console.log(`  Target: ${chalk.cyan(this.currentTarget)}`);
          console.log(
            `  Conversation: ${chalk.cyan(this.currentConversation ?? '(default)')}`,
          );
          console.log(`  Active conversations: ${convos.length}`);
          for (const c of convos) {
            const name = c.data.name ? ` [${c.data.name}]` : '';
            const msgCount = c.data.messages.length;
            console.log(
              chalk.dim(
                `    ${c.data.initiatorId} → ${c.data.targetId}${name}  (${msgCount} msgs)`,
              ),
            );
          }
        }
        console.log();
        break;
      }

      case 'send': {
        if (args.length < 2) {
          console.log(chalk.yellow('Usage: /send <participantId> <message>'));
          break;
        }
        const [targetId, ...msgParts] = args;
        const message = msgParts.join(' ');
        await this.sendMessage(targetId, message);
        break;
      }

      case 'conversations': {
        if (!this.session) {
          console.log(chalk.yellow('\n  No active session.'));
          break;
        }
        const convos = this.session.listConversations();
        if (convos.length === 0) {
          console.log(chalk.dim('\n  No conversations yet.'));
        } else {
          console.log(chalk.bold(`\nConversations (${convos.length}):`))
          for (const c of convos) {
            const name = c.data.name ? ` [${c.data.name}]` : '';
            const msgCount = c.data.messages.length;
            const isCurrent =
              c.data.initiatorId === 'user' &&
              c.data.targetId === this.currentTarget &&
              c.data.name === this.currentConversation;
            const marker = isCurrent ? chalk.green(' ← current') : '';
            console.log(
              `  ${c.data.initiatorId} → ${c.data.targetId}${name}  ` +
              chalk.dim(`(${msgCount} msgs)`) + marker,
            );
          }
        }
        console.log();
        break;
      }

      case 'history': {
        if (!this.session) {
          console.log(chalk.yellow('\n  No active session.'));
          break;
        }
        const count = args.length > 0 ? parseInt(args[0], 10) : 20;
        if (isNaN(count) || count < 1) {
          console.log(chalk.yellow('Usage: /history [n]  (n must be a positive number)'));
          break;
        }
        // Find the current conversation
        const allConvos = this.session.listConversations();
        const currentConvo = allConvos.find(
          (c) =>
            c.data.initiatorId === 'user' &&
            c.data.targetId === this.currentTarget &&
            c.data.name === this.currentConversation,
        );
        if (!currentConvo || currentConvo.data.messages.length === 0) {
          console.log(chalk.dim('\n  No messages in the current conversation yet.'));
          console.log();
          break;
        }
        const msgs = currentConvo.data.messages;
        const start = Math.max(0, msgs.length - count);
        const shown = msgs.slice(start);
        const label = this.currentConversation
          ? `you → ${this.currentTarget} [${this.currentConversation}]`
          : `you → ${this.currentTarget}`;
        console.log(
          chalk.bold(`\nHistory: ${label}`) +
          chalk.dim(` (showing ${shown.length} of ${msgs.length})`),
        );
        for (const m of shown) {
          const time = new Date(m.timestamp).toLocaleTimeString();
          const roleColor = m.role === 'user' ? chalk.green : chalk.cyan;
          const name = m.role === 'user' ? 'you' : this.currentTarget;
          const toolInfo = m.toolCalls?.length
            ? chalk.dim(` [${m.toolCalls.length} tool call${m.toolCalls.length > 1 ? 's' : ''}]`)
            : '';
          const content = m.content.length > 200
            ? m.content.slice(0, 200) + chalk.dim('...')
            : m.content;
          console.log(`  ${chalk.dim(time)} ${roleColor(name + '>')} ${content}${toolInfo}`);
        }
        console.log();
        break;
      }

      case 'tools': {
        const target = this.workspace.collective.get(this.currentTarget);
        if (!target) {
          console.log(chalk.red(`\n  ✗ Unknown participant: ${this.currentTarget}`));
          break;
        }
        const resolved = this.workspace.toolRegistry.resolveForParticipant(target.tools);
        if (resolved.length === 0) {
          console.log(chalk.dim('\n  No tools available for this participant.'));
        } else {
          console.log(chalk.bold(`\nTools for ${chalk.cyan(this.currentTarget)} (${resolved.length}):`));
          for (const t of resolved) {
            const policy = target.tools[t.name] ?? target.tools['*'];
            const mode = policy ? chalk.dim(` [${policy.mode}]`) : '';
            console.log(`  ${chalk.cyan(t.name)}${mode}`);
            console.log(chalk.dim(`    ${t.description}`));
          }
        }
        console.log();
        break;
      }

      case 'ps': {
        if (!this.processRegistry) {
          console.log(chalk.dim('\n  Process registry not initialized.'));
          console.log();
          break;
        }
        const procs = this.processRegistry.list('all');
        if (procs.length === 0) {
          console.log(chalk.dim('\n  No tracked processes.'));
        } else {
          const running = procs.filter((p) => p.state === 'running');
          const exited = procs.filter((p) => p.state === 'exited');
          console.log(chalk.bold(`\nProcesses (${running.length} running, ${exited.length} exited):`));
          for (const p of procs) {
            const label = p.label ? ` (${p.label})` : '';
            const cmd = p.command.length > 60 ? p.command.slice(0, 57) + '...' : p.command;
            if (p.state === 'running') {
              const elapsed = Math.round((Date.now() - p.startedAt.getTime()) / 1000);
              const duration = elapsed < 60
                ? `${elapsed}s`
                : `${Math.floor(elapsed / 60)}m${elapsed % 60}s`;
              console.log(
                chalk.green(`  #${p.processId}`) +
                ` ${cmd}${label}` +
                chalk.dim(` — running ${duration}, pid ${p.pid}`),
              );
            } else {
              const exitColor = p.exitCode === 0 ? chalk.green : chalk.red;
              console.log(
                chalk.dim(`  #${p.processId}`) +
                ` ${cmd}${label}` +
                exitColor(` — exited (${p.exitCode})`),
              );
            }
          }
        }
        console.log();
        break;
      }

      case 'output': {
        if (!this.processRegistry) {
          console.log(chalk.dim('\n  Process registry not initialized.'));
          console.log();
          break;
        }
        if (args.length === 0) {
          console.log(chalk.yellow('Usage: /output <processId> [lines]'));
          break;
        }
        const procId = parseInt(args[0], 10);
        if (isNaN(procId)) {
          console.log(chalk.yellow('  Process ID must be a number.'));
          break;
        }
        const proc = this.processRegistry.get(procId);
        if (!proc) {
          console.log(chalk.red(`\n  ✗ No process with ID #${procId}`));
          console.log();
          break;
        }
        const lineCount = args.length > 1 ? parseInt(args[1], 10) : 50;
        const outputLines = isNaN(lineCount) || lineCount < 1 ? 50 : lineCount;
        const output = proc.output.tail(outputLines);
        const procLabel = proc.label ? ` (${proc.label})` : '';
        console.log(
          chalk.bold(`\nOutput from #${procId}${procLabel}:`) +
          chalk.dim(` ${proc.command}`),
        );
        if (!output) {
          console.log(chalk.dim('  (no output)'));
        } else {
          console.log(output);
        }
        console.log();
        break;
      }

      case 'kill': {
        if (!this.processRegistry) {
          console.log(chalk.dim('\n  Process registry not initialized.'));
          console.log();
          break;
        }
        if (args.length === 0) {
          console.log(chalk.yellow('Usage: /kill <processId>'));
          break;
        }
        const killId = parseInt(args[0], 10);
        if (isNaN(killId)) {
          console.log(chalk.yellow('  Process ID must be a number.'));
          break;
        }
        const killProc = this.processRegistry.get(killId);
        if (!killProc) {
          console.log(chalk.red(`\n  ✗ No process with ID #${killId}`));
          console.log();
          break;
        }
        if (killProc.state !== 'running') {
          console.log(chalk.dim(`\n  Process #${killId} is already exited (code ${killProc.exitCode}).`));
          console.log();
          break;
        }
        try {
          await this.processRegistry.stop(killId);
          console.log(chalk.green(`\n  ✓ Process #${killId} stopped.`));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.log(chalk.red(`\n  ✗ Failed to stop process #${killId}: ${errMsg}`));
        }
        console.log();
        break;
      }

      case 'approvals': {
        if (!this.session) {
          console.log(chalk.yellow('\n  No active session.'));
          console.log();
          break;
        }
        const count = args.length > 0 ? parseInt(args[0], 10) : 10;
        const limit = isNaN(count) || count < 1 ? 10 : count;
        const sessionStorage = this.workspace.storage.scope('sessions');
        const log = new ApprovalLog(sessionStorage);
        const records = await log.list(this.session.data.id, { limit });
        if (records.length === 0) {
          console.log(chalk.dim('\n  No approval records in this session yet.'));
        } else {
          console.log(chalk.bold(`\nApprovals (${records.length} shown):`));
          for (const r of records) {
            const time = new Date(r.requestedAt).toLocaleTimeString();
            const decisionColor =
              r.decision === 'approved' || r.decision === 'auto_approved'
                ? chalk.green
                : chalk.red;
            const reason = r.reason ? chalk.dim(` — ${r.reason}`) : '';
            const ms = chalk.dim(` (${r.durationMs}ms)`);
            console.log(
              `  ${chalk.dim(time)} ${decisionColor(r.decision.padEnd(14))} ` +
              `${chalk.cyan(r.requestingParticipantId)} → ${chalk.cyan(r.toolName)}` +
              `${reason}${ms}`,
            );
          }
        }
        console.log();
        break;
      }

      default:
        console.log(chalk.yellow(`Unknown command: /${command}`));
        console.log(chalk.dim('Type /help for available commands.'));
        break;
    }
  }

  /**
   * Prompt the user for input during an agent→user message.
   *
   * Called by REPLRuntime via the prompt handler callback.
   * Uses rl.question() which internally intercepts the next line
   * before the normal 'line' event fires, so there's no conflict
   * with the REPL's own line handler.  We pause readline again
   * afterward so the outer finally block finds it in the expected
   * paused state.
   */
  private promptUser(question: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.rl!.question(question, (answer) => {
        // rl.question() internally resumed readline to get input.
        // Pause it again so the REPL's line-handler finally block
        // can resume it cleanly without double-resuming.
        this.rl!.pause();
        resolve(answer);
      });
    });
  }

  /**
   * Clean up session resources (kill background processes, etc.).
   */
  private async cleanup(): Promise<void> {
    if (this.processRegistry) {
      const running = this.processRegistry.runningCount();
      if (running > 0) {
        console.log(chalk.dim(`\n  Stopping ${running} background process${running === 1 ? '' : 'es'}...`));
      }
      await this.processRegistry.killAll();
      this.processRegistry = null;
    }
  }

  /**
   * Create a minimal RuntimeContext for dispatching from the REPL.
   */
  private createContext(): RuntimeContext {
    const userConfig = this.workspace.collective.get('user') ?? {
      id: 'user',
      type: 'user' as const,
      name: 'User',
      description: 'CLI User',
      tools: {},
      approvalAuthority: {},
      status: 'active' as const,
      medium: { type: 'cli' },
    };

    return {
      participant: userConfig,
      conversation: null as unknown as RuntimeContext['conversation'],
      session: this.session!,
      communicationDepth: 0,
      toolRegistry: this.workspace.toolRegistry,
      config: this.workspace.config,
      eventBus: this.workspace.eventBus,
      storage: this.workspace.storage,
      workspaceRoot: this.workspace.root,
      authEngine: this.authEngine,
      pendingApprovalRegistry: this.workspace.pendingApprovalRegistry,
    };
  }
}
