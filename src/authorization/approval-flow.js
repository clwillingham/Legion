import { v4 as uuidv4 } from 'uuid';

/**
 * @typedef {Object} ApprovalRequest
 * @property {string} id
 * @property {string} requesterId - Agent requesting approval for the tool call
 * @property {string} toolName
 * @property {Object} toolInput
 * @property {string} toolCallId - The original tool_use ID
 * @property {'pending' | 'approved' | 'rejected'} status
 * @property {string} [reason]
 * @property {string} timestamp
 */

/**
 * Manages the lifecycle of approval requests.
 *
 * Approval uses a suspension/resumption model:
 *
 * When an agent's tool call requires approval, execution suspends and the
 * approval request cascades up the communication chain mechanically:
 *
 * - If the immediate caller (senderId) is a **user**: prompt them directly
 *   via REPL for each pending approval individually. The tool executor
 *   blocks until all decisions are provided.
 *
 * - If the immediate caller is an **agent**: use the SuspensionHandler to
 *   signal the communicator that approval is needed. The tool executor
 *   blocks on a promise that resolves when decisions cascade back down
 *   from up the chain.
 *
 * Agents don't need to understand the approval protocol — it is handled
 * transparently by the system through the SuspensionHandler ↔ Communicator
 * bridge.
 */
export class ApprovalFlow {
  #collective;
  #repl;
  #activityLogger;

  /**
   * @param {Object} deps
   * @param {import('../collective/collective.js').Collective} deps.collective
   * @param {import('../repl/repl.js').Repl} deps.repl
   * @param {import('../repl/activity-logger.js').ActivityLogger} [deps.activityLogger]
   */
  constructor({ collective, repl, activityLogger }) {
    this.#collective = collective;
    this.#repl = repl;
    this.#activityLogger = activityLogger || null;
  }

  /**
   * Request approval for a batch of tool calls.
   *
   * If the immediate caller is a user, prompts them directly via REPL.
   * If the immediate caller is an agent, uses the SuspensionHandler to
   * signal up the communication chain and block until decisions arrive.
   *
   * @param {Object} params
   * @param {import('./suspension-handler.js').PendingApproval[]} params.pendingApprovals
   * @param {string} params.senderId - The immediate caller
   * @param {import('./suspension-handler.js').SuspensionHandler} [params.suspensionHandler]
   * @returns {Promise<Map<string, 'approved'|'rejected'>>} Decisions keyed by toolCallId
   */
  async requestBatchApproval({ pendingApprovals, senderId, suspensionHandler }) {
    const sender = this.#collective.getParticipant(senderId);

    // Log all pending approvals
    for (const pa of pendingApprovals) {
      const requester = this.#collective.getParticipant(pa.requesterId);
      this.#activityLogger?.approvalRequested(
        requester?.name || pa.requesterId,
        pa.toolName,
        sender?.name || senderId
      );
    }

    // If the immediate caller is a user, prompt them directly via REPL
    if (sender && sender.type === 'user') {
      const decisions = new Map();
      for (const pa of pendingApprovals) {
        /** @type {ApprovalRequest} */
        const request = {
          id: pa.id,
          requesterId: pa.requesterId,
          toolName: pa.toolName,
          toolInput: pa.toolInput,
          toolCallId: pa.toolCallId,
          status: 'pending',
          timestamp: new Date().toISOString(),
        };
        const decision = await this.#repl.promptApproval(request);
        decisions.set(pa.toolCallId, decision);
        this.#activityLogger?.approvalDecision(
          sender.name || senderId,
          pa.toolName,
          decision
        );
      }
      return decisions;
    }

    // Caller is an agent — use SuspensionHandler to signal up the chain
    if (!suspensionHandler) {
      // No suspension handler means we can't propagate — reject all as safety fallback
      const decisions = new Map();
      for (const pa of pendingApprovals) {
        decisions.set(pa.toolCallId, 'rejected');
        this.#activityLogger?.approvalDecision(
          'system',
          pa.toolName,
          'rejected'
        );
      }
      return decisions;
    }

    // This blocks until someone up the chain provides decisions
    const decisions = await suspensionHandler.requestApproval(pendingApprovals);

    // Log the decisions that came back
    for (const pa of pendingApprovals) {
      const decision = decisions.get(pa.toolCallId) || 'rejected';
      this.#activityLogger?.approvalDecision(
        sender?.name || senderId,
        pa.toolName,
        decision
      );
    }

    return decisions;
  }
}
