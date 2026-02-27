/**
 * Authorization policies — define how tool calls are authorized.
 *
 * Two modes:
 * - 'auto': tool executes immediately without user approval.
 * - 'requires_approval': tool execution is paused until the user approves/rejects.
 * - 'deny': tool call is rejected outright.
 */

export type AuthorizationPolicy = 'auto' | 'requires_approval' | 'deny';

/**
 * Default policies for built-in tools.
 *
 * Read operations are auto-approved. Write operations and
 * communication require approval by default.
 */
export const DEFAULT_TOOL_POLICIES: Record<string, AuthorizationPolicy> = {
  // Read operations — auto
  file_read: 'auto',
  list_participants: 'auto',
  get_participant: 'auto',

  // Write operations — requires approval
  file_write: 'requires_approval',

  // Communication — auto (depth limits provide safety)
  communicate: 'auto',
};

/**
 * Resolve the authorization policy for a tool.
 *
 * Resolution order:
 * 1. Per-tool override from config
 * 2. Default policy from config
 * 3. Built-in default for the tool
 * 4. Global fallback: 'requires_approval'
 */
export function resolvePolicy(
  toolName: string,
  configToolPolicies?: Record<string, AuthorizationPolicy>,
  configDefaultPolicy?: AuthorizationPolicy,
): AuthorizationPolicy {
  // Per-tool override
  if (configToolPolicies?.[toolName]) {
    return configToolPolicies[toolName];
  }

  // Config default
  if (configDefaultPolicy) {
    return configDefaultPolicy;
  }

  // Built-in default
  if (DEFAULT_TOOL_POLICIES[toolName]) {
    return DEFAULT_TOOL_POLICIES[toolName];
  }

  // Global fallback — require approval for unknown tools
  return 'requires_approval';
}
