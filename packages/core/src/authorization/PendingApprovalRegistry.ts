import type { RuntimeResult } from '../runtime/ParticipantRuntime.js';

// ============================================================
// Pending Approval Request — info about one held tool call
// ============================================================

/**
 * A single tool call that is waiting for approval from the calling participant.
 */
export interface PendingApprovalRequest {
  /** Unique ID for this approval request (used in approval_response). */
  requestId: string;

  /** The LLM tool call ID this corresponds to (for injecting results back). */
  toolCallId: string;

  /** The tool name. */
  toolName: string;

  /** The arguments passed to the tool. */
  toolArguments: Record<string, unknown>;
}

// ============================================================
// Pending Approval Batch — one held pause-point per conversation
// ============================================================

/**
 * All the pending tool calls from a single AgentRuntime iteration,
 * waiting for the calling participant to approve or reject them.
 *
 * The `resume` callback restores execution: it executes (or skips)
 * the held tool calls based on the provided decisions, then continues
 * the agentic loop to completion.
 */
export interface PendingApprovalBatch {
  /** Uniquely identifies the paused conversation. */
  conversationId: string;

  /** The participant whose runtime is paused (the "downstream" agent). */
  requestingParticipantId: string;

  /** The participant who must provide the approval decisions (the caller). */
  callingParticipantId: string;

  /** The pending tool calls awaiting a decision. */
  requests: PendingApprovalRequest[];

  /**
   * Call this with a map of `requestId → decision` to resume execution.
   *
   * Returns the final RuntimeResult once Agent B has finished running.
   * Tools approved are executed; tools rejected get an error result.
   */
  resume: (
    decisions: Map<string, { approved: boolean; reason?: string }>,
  ) => Promise<RuntimeResult>;
}

// ============================================================
// PendingApprovalRegistry — runtime registry for paused agents
// ============================================================

/**
 * Tracks conversations that are "paused" waiting for caller approval.
 *
 * Lifecycle:
 * 1. AgentRuntime (Agent B) encounters tools needing caller approval.
 * 2. It calls `registry.store(conversationId, batch)` and returns
 *    `{ status: 'approval_required' }` to the communicate tool.
 * 3. The communicate tool bubble the pending requests up to Agent A.
 * 4. Agent A calls the `approval_response` tool with decisions.
 * 5. `approval_response` calls `registry.resume(conversationId, decisions)`.
 * 6. The resume callback finishes Agent B's execution and returns.
 * 7. `approval_response` returns Agent B's final result to Agent A.
 * 8. The entry is cleared from the registry.
 *
 * Every Workspace owns one singleton registry, shared across all sessions
 * and conversations via RuntimeContext.
 */
export class PendingApprovalRegistry {
  /** conversationId → pending batch */
  private batches: Map<string, PendingApprovalBatch> = new Map();

  /** requestId → conversationId (for fast O(1) lookup by request) */
  private requestToConversation: Map<string, string> = new Map();

  /**
   * Store a new pending approval batch for the given conversation.
   * Replaces any existing batch for the same conversation (though
   * a conversation should only be paused once at a time).
   */
  store(conversationId: string, batch: PendingApprovalBatch): void {
    // Clean up any old index entries for this conversation
    const existing = this.batches.get(conversationId);
    if (existing) {
      for (const req of existing.requests) {
        this.requestToConversation.delete(req.requestId);
      }
    }

    this.batches.set(conversationId, batch);
    for (const req of batch.requests) {
      this.requestToConversation.set(req.requestId, conversationId);
    }
  }

  /**
   * Get the pending batch for a conversation, if any.
   */
  get(conversationId: string): PendingApprovalBatch | undefined {
    return this.batches.get(conversationId);
  }

  /**
   * Find the batch that contains the given requestId.
   * Returns undefined if the requestId is unknown.
   */
  getByRequestId(requestId: string): PendingApprovalBatch | undefined {
    const conversationId = this.requestToConversation.get(requestId);
    return conversationId ? this.batches.get(conversationId) : undefined;
  }

  /**
   * Returns true if the conversation has pending approvals.
   */
  hasPending(conversationId: string): boolean {
    return this.batches.has(conversationId);
  }

  /**
   * Remove the pending batch for a conversation (called after resumption
   * completes or if the conversation is abandoned).
   */
  clear(conversationId: string): void {
    const batch = this.batches.get(conversationId);
    if (!batch) return;

    for (const req of batch.requests) {
      this.requestToConversation.delete(req.requestId);
    }
    this.batches.delete(conversationId);
  }

  /**
   * Return all currently pending conversation IDs.
   */
  listPending(): string[] {
    return Array.from(this.batches.keys());
  }
}
