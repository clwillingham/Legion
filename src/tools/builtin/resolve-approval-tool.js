import { Tool } from '../tool.js';

/**
 * Tool for agents with approval authority to approve or reject
 * pending tool call requests.
 *
 * When approved, this tool blocks until the inner agent's session finishes
 * and returns the agent's response. When rejected, it returns immediately
 * with a confirmation.
 */
export class ResolveApprovalTool extends Tool {
  #pendingApprovalStore;
  #activityLogger;

  /**
   * @param {Object} deps
   * @param {import('../../authorization/pending-approval-store.js').PendingApprovalStore} deps.pendingApprovalStore
   * @param {import('../../repl/activity-logger.js').ActivityLogger} [deps.activityLogger]
   */
  constructor({ pendingApprovalStore, activityLogger }) {
    super();
    this.#pendingApprovalStore = pendingApprovalStore;
    this.#activityLogger = activityLogger || null;
  }

  get name() { return 'resolve_approval'; }

  get definition() {
    return {
      name: 'resolve_approval',
      description: 'Approve or reject a pending tool call that requires your authorization. When you receive an approval request as a communicator tool_result, review the details and use this tool to submit your decision. If you approve, the agent\'s session will resume and this tool will return the agent\'s final response once complete. If you reject, the agent will be informed and can adapt.',
      inputSchema: {
        type: 'object',
        properties: {
          requestId: {
            type: 'string',
            description: 'The approval request ID provided in the approval request details.',
          },
          decision: {
            type: 'string',
            enum: ['approved', 'rejected'],
            description: 'Your decision: "approved" to allow the tool call to execute, or "rejected" to deny it.',
          },
          reason: {
            type: 'string',
            description: 'Optional reason for your decision (especially useful for rejections so the agent can adapt).',
          },
        },
        required: ['requestId', 'decision'],
      },
    };
  }

  async execute(input, context) {
    const { requestId, decision, reason } = input;

    if (!this.#pendingApprovalStore.has(requestId)) {
      return `Error: No pending approval request found with ID "${requestId}". It may have already been resolved or expired.`;
    }

    const entry = this.#pendingApprovalStore.get(requestId);
    const { pendingApprovals, resolve, runPromise } = entry;

    // Build decisions map — apply the same decision to all tool calls in the batch
    const decisions = new Map();
    for (const pa of pendingApprovals) {
      decisions.set(pa.toolCallId, decision);
      this.#activityLogger?.approvalDecision(
        context.callerId,
        pa.toolName,
        decision
      );
    }

    // Resolve the suspension promise — this unblocks the inner agent's session
    resolve(decisions);

    // Clean up the store entry
    this.#pendingApprovalStore.delete(requestId);

    const toolNames = pendingApprovals.map(pa => pa.toolName).join(', ');

    if (decision === 'approved') {
      // Wait for the inner agent's session to complete and return its response
      try {
        const agentResponse = await runPromise;
        return `Approved: tool call(s) [${toolNames}] approved and executed.\n\nAgent response:\n${agentResponse}`;
      } catch (err) {
        return `Approved: tool call(s) [${toolNames}] approved, but the agent encountered an error: ${err.message}`;
      }
    } else {
      const reasonText = reason ? ` Reason: ${reason}` : '';
      // For rejection, the inner session will also complete (agent sees rejection and responds)
      // Wait for it so the communicator properly finishes
      try {
        const agentResponse = await runPromise;
        return `Rejected: tool call(s) [${toolNames}] rejected.${reasonText}\n\nAgent response:\n${agentResponse}`;
      } catch (err) {
        return `Rejected: tool call(s) [${toolNames}] rejected.${reasonText}`;
      }
    }
  }
}
