import type { ApprovalRequest } from './ApprovalRequest.js';
import { createApprovalRequest } from './ApprovalRequest.js';
import {
  resolvePolicy,
  type AuthorizationPolicy,
} from './policies.js';
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
 */
export class AuthEngine {
  private approvalHandler?: ApprovalHandler;
  private toolPolicies: Record<string, AuthorizationPolicy>;
  private defaultPolicy: AuthorizationPolicy;
  private eventBus?: EventBus;

  constructor(options?: {
    toolPolicies?: Record<string, AuthorizationPolicy>;
    defaultPolicy?: AuthorizationPolicy;
    eventBus?: EventBus;
  }) {
    this.toolPolicies = options?.toolPolicies ?? {};
    this.defaultPolicy = options?.defaultPolicy ?? 'requires_approval';
    this.eventBus = options?.eventBus;
  }

  /**
   * Register the approval handler (called by the CLI/UI layer).
   */
  setApprovalHandler(handler: ApprovalHandler): void {
    this.approvalHandler = handler;
  }

  /**
   * Check authorization for a tool call.
   *
   * Returns:
   * - 'approved' if the tool is auto-approved or user approves.
   * - 'denied' if the policy is deny or user rejects.
   */
  async authorize(
    participantId: string,
    toolName: string,
    args: Record<string, unknown>,
    participantToolPolicies?: Record<string, { mode: string }>,
  ): Promise<{ authorized: boolean; reason?: string }> {
    // Merge participant-level policies with engine-level policies.
    // Participant policies take priority.
    const mergedPolicies: Record<string, AuthorizationPolicy> = {
      ...this.toolPolicies,
    };
    if (participantToolPolicies) {
      for (const [name, policy] of Object.entries(participantToolPolicies)) {
        if (name === '*') continue; // wildcard means "access to all", not a policy override
        mergedPolicies[name] = policy.mode as AuthorizationPolicy;
      }
    }

    const policy = resolvePolicy(
      toolName,
      mergedPolicies,
      this.defaultPolicy,
    );

    if (policy === 'auto') {
      return { authorized: true };
    }

    if (policy === 'deny') {
      return {
        authorized: false,
        reason: `Tool "${toolName}" is denied by policy.`,
      };
    }

    // requires_approval — delegate to the approval handler
    if (!this.approvalHandler) {
      // No approval handler registered — deny by default
      return {
        authorized: false,
        reason: 'No approval handler registered. Cannot approve tool call.',
      };
    }

    const request = createApprovalRequest(participantId, toolName, args);

    // Emit approval requested event
    this.eventBus?.emit({
      type: 'approval:requested',
      sessionId: '',
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
  setDefaultPolicy(policy: AuthorizationPolicy): void {
    this.defaultPolicy = policy;
  }
}
