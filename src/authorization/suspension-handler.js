/**
 * @typedef {Object} PendingApproval
 * @property {string} id - Unique approval request ID
 * @property {string} requesterId - Agent requesting approval
 * @property {string} toolName - Tool requiring approval
 * @property {Object} toolInput - Tool arguments
 * @property {string} toolCallId - The original tool_use ID
 */

/**
 * @typedef {Object} SuspensionSignal
 * @property {PendingApproval[]} pendingApprovals
 * @property {function(Map<string, 'approved'|'rejected'>): void} resolve - Call with decisions to resume
 */

/**
 * Bridges the gap between inner code that needs approval and outer code
 * that can provide it.
 *
 * The inner side (ApprovalFlow) calls `requestApproval()` which:
 * 1. Signals the outer side that approvals are needed
 * 2. Blocks until the outer side provides decisions
 *
 * The outer side (Communicator) calls `waitForSuspension()` which:
 * 1. Returns a promise that fires when the inner side needs approval
 * 2. Includes the pending approvals and a `resolve` function
 *
 * Renewable — can handle multiple suspension rounds in a single agent run
 * (e.g., an agent that makes tool calls requiring approval across multiple
 * iterations of the tool loop).
 */
export class SuspensionHandler {
  /** @type {Promise<SuspensionSignal>} */
  #currentPromise;
  /** @type {function(SuspensionSignal): void} */
  #currentResolve;

  constructor() {
    this.#renew();
  }

  /**
   * Called by ApprovalFlow when approval is needed from an agent caller.
   * Signals the outer side (communicator) and blocks until decisions arrive.
   *
   * @param {PendingApproval[]} pendingApprovals
   * @returns {Promise<Map<string, 'approved'|'rejected'>>} Decisions keyed by toolCallId
   */
  async requestApproval(pendingApprovals) {
    /** @type {function(Map<string, 'approved'|'rejected'>): void} */
    let decisionResolve;
    /** @type {Promise<Map<string, 'approved'|'rejected'>>} */
    const decisionPromise = new Promise((resolve) => {
      decisionResolve = resolve;
    });

    // Signal the outer side that we need approval
    this.#currentResolve({
      pendingApprovals,
      resolve: decisionResolve,
    });

    // Renew for potential future suspensions in the same agent run
    this.#renew();

    // Block until decisions arrive from the outer side
    return decisionPromise;
  }

  /**
   * Returns a promise that fires when the inner side needs approval.
   * Used by the communicator to detect when an agent's tool loop has suspended.
   *
   * @returns {Promise<SuspensionSignal>}
   */
  waitForSuspension() {
    return this.#currentPromise;
  }

  /**
   * Create a new promise pair for the next suspension event.
   * Called after each suspension is signaled so the handler can be reused.
   */
  #renew() {
    /** @type {function(SuspensionSignal): void} */
    let resolve;
    this.#currentPromise = new Promise((r) => {
      resolve = r;
    });
    this.#currentResolve = resolve;
  }
}
