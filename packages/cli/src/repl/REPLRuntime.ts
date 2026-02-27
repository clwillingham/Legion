import chalk from 'chalk';
import {
  ParticipantRuntime,
  type RuntimeContext,
  type RuntimeResult,
} from '@legion/core';
import { createInterface } from 'node:readline';

/**
 * Minimal spinner interface so we don't depend on ora types directly.
 */
interface Spinner {
  stop(): void;
  start(text?: string): void;
  readonly text: string;
}

/**
 * A callback the REPL provides so that all readline management
 * stays in one place.  REPLRuntime never touches readline directly.
 */
export type PromptHandler = (question: string) => Promise<string>;

/**
 * REPLRuntime — runtime for user participants in the CLI.
 *
 * When an agent sends a message to a user, the REPLRuntime
 * displays it and prompts the user for a reply, similar to
 * how AgentRuntime prompts the LLM.
 *
 * All readline interaction is delegated back to the REPL via
 * a prompt handler callback, avoiding conflicting pause/resume
 * and duplicate line-event issues.
 */
export class REPLRuntime extends ParticipantRuntime {
  private promptHandler: PromptHandler | null = null;
  private spinnerGetter: (() => Spinner | null) | null = null;

  /**
   * Set the prompt handler used to ask the user for input.
   * The REPL provides this so it can coordinate readline state.
   */
  setPromptHandler(handler: PromptHandler): void {
    this.promptHandler = handler;
  }

  /**
   * Set a getter for the active spinner so we can pause it
   * while prompting the user for input.
   */
  setSpinnerGetter(getter: () => Spinner | null): void {
    this.spinnerGetter = getter;
  }

  async handleMessage(
    message: string,
    context: RuntimeContext,
  ): Promise<RuntimeResult> {
    // Pause the spinner so the user can see their own typing
    const spinner = this.spinnerGetter?.();
    const spinnerText = spinner?.text ?? '';
    spinner?.stop();

    // Show who's contacting the user
    const fromId = context.conversation.data.initiatorId === 'user'
      ? context.conversation.data.targetId
      : context.conversation.data.initiatorId;

    console.log();
    console.log(chalk.yellow.bold(`  💬 Message from ${fromId}:`));
    console.log(`  ${message}`);
    console.log();

    // Prompt for a response using the shared readline
    const reply = await this.prompt(chalk.green('  your reply> '));

    // Restart the spinner
    spinner?.start(spinnerText);

    return {
      status: 'success',
      response: reply,
    };
  }

  private prompt(question: string): Promise<string> {
    // Delegate to the REPL-provided handler if available
    if (this.promptHandler) {
      return this.promptHandler(question);
    }

    // Fallback: create a temporary readline (shouldn't normally happen)
    return new Promise<string>((resolve) => {
      const tempRl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      tempRl.question(question, (answer) => {
        tempRl.close();
        resolve(answer);
      });
    });
  }
}
