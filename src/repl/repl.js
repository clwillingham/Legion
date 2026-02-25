import { createInterface } from 'node:readline';
import {
  formatAgentMessage,
  formatApprovalRequest,
  formatInfo,
  formatError,
} from './display.js';

/**
 * readline-based REPL for human participation.
 */
export class Repl {
  /** @type {import('node:readline').Interface|null} */
  #rl = null;
  /** @type {boolean} */
  #running = false;

  /**
   * Start the REPL. Sets up readline interface.
   */
  start() {
    this.#rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.#running = true;
  }

  /**
   * Stop the REPL. Closes readline interface.
   */
  stop() {
    this.#running = false;
    if (this.#rl) {
      this.#rl.close();
      this.#rl = null;
    }
  }

  /**
   * Prompt the user for input (blocking until they respond).
   * @param {string} promptText
   * @returns {Promise<string>}
   */
  async prompt(promptText) {
    return new Promise((resolve) => {
      this.#rl.question(promptText, (answer) => {
        resolve(answer);
      });
    });
  }

  /**
   * Display a message from an agent to the user.
   * @param {string} fromName - Agent name or ID
   * @param {string} message
   */
  displayMessage(fromName, message) {
    process.stdout.write(formatAgentMessage(fromName, message));
  }

  /**
   * Prompt the user for an approval decision.
   * @param {import('../authorization/approval-flow.js').ApprovalRequest} request
   * @param {string} [requesterName] - Display name of the requester
   * @returns {Promise<'approved' | 'rejected'>}
   */
  async promptApproval(request, requesterName) {
    process.stdout.write(formatApprovalRequest(request, requesterName || request.requesterId));

    while (true) {
      const answer = await this.prompt('> ');
      const lower = answer.trim().toLowerCase();

      if (lower === 'a' || lower === 'approve' || lower === 'yes' || lower === 'y') {
        return 'approved';
      }
      if (lower === 'r' || lower === 'reject' || lower === 'no' || lower === 'n') {
        return 'rejected';
      }

      process.stdout.write(formatInfo('Please enter [a]pprove or [r]eject\n'));
    }
  }

  /**
   * Display a status/info message.
   * @param {string} message
   */
  displayInfo(message) {
    process.stdout.write(formatInfo(message) + '\n');
  }

  /**
   * Display an error message.
   * @param {string} message
   */
  displayError(message) {
    process.stdout.write(formatError(message) + '\n');
  }

  /**
   * Handle the main user input loop.
   * @param {function(string): Promise<void>} onMessage - Callback for user messages
   * @returns {Promise<void>}
   */
  async inputLoop(onMessage) {
    while (this.#running) {
      const input = await this.prompt('\n[You] > ');
      const trimmed = input.trim();

      if (!trimmed) continue;
      if (trimmed === '/quit' || trimmed === '/exit') {
        break;
      }

      await onMessage(trimmed);
    }
  }

  /** @returns {boolean} */
  get running() {
    return this.#running;
  }
}
