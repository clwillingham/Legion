/**
 * ApprovalRequest — represents a pending tool call awaiting user approval.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
  /** Unique request ID. */
  id: string;

  /** The participant requesting the tool call. */
  participantId: string;

  /** The tool being called. */
  toolName: string;

  /** The arguments to the tool call. */
  arguments: Record<string, unknown>;

  /** Current status. */
  status: ApprovalStatus;

  /** Optional reason (set on rejection). */
  reason?: string;

  /** When the request was created. */
  createdAt: Date;

  /** When the request was resolved. */
  resolvedAt?: Date;
}

/**
 * Create a new pending approval request.
 */
export function createApprovalRequest(
  participantId: string,
  toolName: string,
  args: Record<string, unknown>,
): ApprovalRequest {
  return {
    id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    participantId,
    toolName,
    arguments: args,
    status: 'pending',
    createdAt: new Date(),
  };
}
