import { createInterface, type Interface } from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import type { Workspace } from '@legion/core';
import { Session, AuthEngine, AgentRuntime, MockRuntime } from '@legion/core';
import type { RuntimeContext } from '@legion/core';
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
    this.authEngine = new AuthEngine();
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
   */
  private buildPrompt(): string {
    const target = chalk.dim(`[→ ${this.currentTarget}`);
    const convo = this.currentConversation
      ? chalk.dim(` (${this.currentConversation})`)
      : '';
    return `${target}${convo}${chalk.dim(']')} ${chalk.green('you> ')}`;
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

    // Wire up event handlers for display
    registerEventHandlers(this.workspace.eventBus);

    // Resolve default target
    this.currentTarget = this.resolveDefaultTarget();

    // Create or resume session
    const sessionName =
      this.sessionName ?? `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;

    this.session = Session.create(
      sessionName,
      this.workspace.storage.scope('sessions'),
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

    this.rl.on('close', () => {
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
        console.log('  /help                    — Show this help');
        console.log('  /quit                    — Exit the session');
        console.log('  /agent [id]              — Show or switch the target agent');
        console.log('  /convo [name]            — Show or switch the conversation name');
        console.log('  /convo clear             — Clear conversation name (use default)');
        console.log('  /send <id> <msg>         — One-off message to a specific participant');
        console.log('  /collective              — List participants');
        console.log('  /session                 — Show session info');
        console.log();
        break;

      case 'quit':
      case 'exit':
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
      authEngine: this.authEngine,
    };
  }
}
