import type { ApprovalRequest } from './ApprovalRequest.js';
import { createApprovalRequest } from './ApprovalRequest.js';
import {
  resolvePolicy,
  type AuthorizationPolicy,
  type ToolPolicy,
} from './policies.js';
import {
  ApprovalLog,
  createApprovalRecordId,
  type ApprovalDecision,
} from './ApprovalLog.js';
import type { EventBus } from '../events/EventBus.js';

/**
 * ApprovalHandler — callback invoked when a tool requires approval.
 *
 * The CLI layer registers a handler that prompts the user.
 * Returns true if approved, false if rejected.
 */
export type ApprovalHandler = (
  request: ApprovalRequest,
) => Promise<{ approved: boolean; reason?: string }>;

/**
 * AuthEngine — authorization engine for tool calls.
 *
 * Checks policies and, when required, delegates to an ApprovalHandler
 * (typically the CLI layer's user prompt).
 *
 * When an ApprovalLog is provided, every authorization decision
 * (auto-approved, approved, rejected, or denied) is persisted.
 */
export class AuthEngine {
  private approvalHandler?: ApprovalHandler;
  private toolPolicies: Record<string, AuthorizationPolicy>;
  private defaultPolicy: AuthorizationPolicy | undefined;
  private eventBus?: EventBus;
  private approvalLog?: ApprovalLog;

  constructor(options?: {
    toolPolicies?: Record<string, AuthorizationPolicy>;
    defaultPolicy?: AuthorizationPolicy;
    eventBus?: EventBus;
    approvalLog?: ApprovalLog;
  }) {
    this.toolPolicies = options?.toolPolicies ?? {};
    this.defaultPolicy = options?.defaultPolicy; // undefined → fall through to built-in defaults
    this.eventBus = options?.eventBus;
    this.approvalLog = options?.approvalLog;
  }

  /**
   * Register the approval handler (called by the CLI/UI layer).
   */
  setApprovalHandler(handler: ApprovalHandler): void {
    this.approvalHandler = handler;
  }

  /**
   * Attach or replace the approval log.
   * Called after the session is created, when the session ID is known.
   */
  setApprovalLog(log: ApprovalLog): void {
    this.approvalLog = log;
  }

  /**
   * Return the effective authorization policy for a tool call without
   * invoking any approval handler.
   *
   * Useful for pre-flight checks (e.g. in AgentRuntime) to decide
   * whether a tool should be sent to a caller for approval before
   * actually attempting execution.
   */
  getEffectivePolicy(
    toolName: string,
    args: Record<string, unknown>,
    participantToolPolicies?: Record<string, ToolPolicy>,
  ): AuthorizationPolicy {
    const filteredParticipantPolicies: Record<string, ToolPolicy> | undefined =
      participantToolPolicies
        ? Object.fromEntries(
            Object.entries(participantToolPolicies).filter(([k]) => k !== '*'),
          )
        : undefined;

    return resolvePolicy(
      toolName,
      args,
      filteredParticipantPolicies,
      this.toolPolicies,
      this.defaultPolicy,
    );
  }

  /**
   * Check authorization for a tool call.
   *
   * Returns:
   * - 'approved' if the tool is auto-approved or user approves.
   * - 'denied' if the policy is deny or user rejects.
   *
   * @param sessionId - The session this tool call belongs to. Used for approval logging.
   */
  async authorize(
    participantId: string,
    toolName: string,
    args: Record<string, unknown>,
    participantToolPolicies?: Record<string, ToolPolicy>,
    sessionId: string = '',
  ): Promise<{ authorized: boolean; reason?: string }> {
    const requestedAt = new Date();

    // Build participant policies map, stripping the '*' wildcard key
    // (which means "access to all tools", not a per-tool policy override).
    const filteredParticipantPolicies: Record<string, ToolPolicy> | undefined =
      participantToolPolicies
        ? Object.fromEntries(
            Object.entries(participantToolPolicies).filter(([k]) => k !== '*'),
          )
        : undefined;

    const policy = resolvePolicy(
      toolName,
      args,
      filteredParticipantPolicies,
      this.toolPolicies,
      this.defaultPolicy,
    );

    if (policy === 'auto') {
      await this.logDecision({
        sessionId,
        requestingParticipantId: participantId,
        decidedByParticipantId: 'system',
        toolName,
        toolArguments: args,
        decision: 'auto_approved',
        policyMode: 'auto',
        requestedAt,
        resolvedAt: new Date(),
      });
      return { authorized: true };
    }

    if (policy === 'deny') {
      const reason = `Tool "${toolName}" is denied by policy.`;
      await this.logDecision({
        sessionId,
        requestingParticipantId: participantId,
        decidedByParticipantId: 'system',
        toolName,
        toolArguments: args,
        decision: 'denied',
        policyMode: 'deny',
        reason,
        requestedAt,
        resolvedAt: new Date(),
      });
      return { authorized: false, reason };
    }

    // requires_approval — delegate to the approval handler
    if (!this.approvalHandler) {
      // No approval handler registered — deny by default
      const reason = 'No approval handler registered. Cannot approve tool call.';
      await this.logDecision({
        sessionId,
        requestingParticipantId: participantId,
        decidedByParticipantId: 'system',
        toolName,
        toolArguments: args,
        decision: 'denied',
        policyMode: 'requires_approval',
        reason,
        requestedAt,
        resolvedAt: new Date(),
      });
      return { authorized: false, reason };
    }

    const request = createApprovalRequest(participantId, toolName, args);

    // Emit approval requested event
    this.eventBus?.emit({
      type: 'approval:requested',
      sessionId,
      participantId,
      toolName,
      arguments: args,
      requestId: request.id,
      timestamp: new Date(),
    });

    const result = await this.approvalHandler(request);

    // Update request status
    request.status = result.approved ? 'approved' : 'rejected';
    request.reason = result.reason;
    request.resolvedAt = new Date();

    // Emit approval resolved event
    this.eventBus?.emit({
      type: 'approval:resolved',
      requestId: request.id,
      approved: result.approved,
      reason: result.reason,
      timestamp: new Date(),
    });

    await this.logDecision({
      id: request.id,
      sessionId,
      requestingParticipantId: participantId,
      decidedByParticipantId: 'user',
      toolName,
      toolArguments: args,
      decision: result.approved ? 'approved' : 'rejected',
      policyMode: 'requires_approval',
      reason: result.reason,
      requestedAt,
      resolvedAt: new Date(),
    });

    return {
      authorized: result.approved,
      reason: result.reason,
    };
  }

  /**
   * Update a tool's policy at runtime.
   */
  setToolPolicy(toolName: string, policy: AuthorizationPolicy): void {
    this.toolPolicies[toolName] = policy;
  }

  /**
   * Update the default policy at runtime.
   */
  setDefaultPolicy(policy: AuthorizationPolicy | undefined): void {
    this.defaultPolicy = policy;
  }

  // ──────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────

  private async logDecision(entry: {
    id?: string;
    sessionId: string;
    requestingParticipantId: string;
    decidedByParticipantId: string;
    toolName: string;
    toolArguments: Record<string, unknown>;
    decision: ApprovalDecision;
    policyMode: 'auto' | 'requires_approval' | 'deny';
    reason?: string;
    requestedAt: Date;
    resolvedAt: Date;
  }): Promise<void> {
    if (!this.approvalLog || !entry.sessionId) return;
    try {
      await this.approvalLog.record({
        id: entry.id ?? createApprovalRecordId(),
        sessionId: entry.sessionId,
        requestingParticipantId: entry.requestingParticipantId,
        decidedByParticipantId: entry.decidedByParticipantId,
        toolName: entry.toolName,
        toolArguments: entry.toolArguments,
        decision: entry.decision,
        policyMode: entry.policyMode,
        reason: entry.reason,
        requestedAt: entry.requestedAt.toISOString(),
        resolvedAt: entry.resolvedAt.toISOString(),
        durationMs: entry.resolvedAt.getTime() - entry.requestedAt.getTime(),
      });
    } catch {
      // Non-fatal — logging failure should never block tool execution
    }
  }
}
