import { z } from 'zod';
import picomatch from 'picomatch';

// ============================================================
// Authorization mode
// ============================================================

/**
 * Authorization modes:
 * - 'auto': tool executes immediately without user approval.
 * - 'requires_approval': execution pauses until a participant approves/rejects.
 * - 'deny': tool call is rejected outright, no escalation.
 */
export type AuthorizationPolicy = 'auto' | 'requires_approval' | 'deny';

// ============================================================
// Scope Conditions
// ============================================================

/**
 * Conditions used to match a tool call's arguments.
 * All defined conditions are ANDed — every condition must pass for
 * the scope to match.
 *
 * `paths`       — Glob patterns matched against path-like args
 *                 (fields named: path, source, destination, cwd, directory).
 *                 ALL path fields that exist in the args must match at
 *                 least one glob pattern.
 *
 * `args`        — Exact-match allowlist for specific arg fields.
 *                 The arg value must be a string in the provided array.
 *
 * `argPatterns` — Regex allowlist for specific arg fields.
 *                 The arg value (as string) must match the pattern.
 */
export const ScopeConditionSchema = z.object({
  paths: z.array(z.string()).optional(),
  args: z.record(z.array(z.string())).optional(),
  argPatterns: z.record(z.string()).optional(),
});

export type ScopeCondition = z.infer<typeof ScopeConditionSchema>;

// ============================================================
// Authorization Rule
// ============================================================

/**
 * A single rule in a policy's rules list.
 * Rules are evaluated in order; the first matching rule wins.
 *
 * A rule with no `scope` is a catch-all and always matches.
 */
export const AuthRuleSchema = z.object({
  mode: z.enum(['auto', 'requires_approval', 'deny']),
  scope: ScopeConditionSchema.optional(),
});

export type AuthRule = z.infer<typeof AuthRuleSchema>;

// ============================================================
// Tool Policy
// ============================================================

/**
 * Tool policy — controls how a specific tool call is authorized.
 *
 * Two forms:
 *
 * Simple form (backward compatible):
 *   { mode: 'auto' | 'requires_approval' | 'deny' }
 *   Equivalent to a single catch-all rule. No scope evaluation.
 *
 * Rules form:
 *   { rules: [ { mode, scope? }, ... ] }
 *   Ordered list of rules. First matching rule's mode is used.
 *   A rule without a scope is a catch-all and always matches.
 *   If no rule matches, the policy falls through to the next level.
 */
export const ToolPolicySchema = z.union([
  z.object({ mode: z.enum(['auto', 'requires_approval', 'deny']) }),
  z.object({ rules: z.array(AuthRuleSchema).min(1) }),
]);

export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

// ============================================================
// Built-in default policies
// ============================================================

/**
 * Built-in default modes for well-known tools.
 * These are simple AuthorizationPolicy strings — no scoping needed at
 * the built-in level. Participant configs override these with full
 * ToolPolicy objects (including rules) when finer control is needed.
 */
export const DEFAULT_TOOL_POLICIES: Record<string, AuthorizationPolicy> = {
  // Read operations — auto
  file_read: 'auto',
  file_analyze: 'auto',
  directory_list: 'auto',
  file_search: 'auto',
  file_grep: 'auto',
  list_participants: 'auto',
  get_participant: 'auto',
  list_sessions: 'auto',
  list_conversations: 'auto',
  inspect_session: 'auto',
  search_history: 'auto',
  process_status: 'auto',
  process_list: 'auto',

  // Write/mutate operations — requires approval by default
  file_write: 'requires_approval',
  file_append: 'requires_approval',
  file_edit: 'requires_approval',
  file_delete: 'requires_approval',
  file_move: 'requires_approval',
  create_agent: 'requires_approval',
  modify_agent: 'requires_approval',
  retire_agent: 'requires_approval',

  // Communication — auto (depth limits provide safety)
  communicate: 'auto',

  // Process execution — requires approval; control ops are auto
  process_exec: 'requires_approval',
  process_start: 'requires_approval',
  process_stop: 'auto',
};

// ============================================================
// Scope evaluation helpers
// ============================================================

/**
 * Field names in tool args that are treated as filesystem paths when
 * evaluating `paths` scope conditions.
 *
 * All of these fields that are present in a tool call's args must each
 * match at least one pattern in `paths` for the condition to pass.
 */
const PATH_ARG_FIELDS = ['path', 'source', 'destination', 'cwd', 'directory'] as const;

/**
 * Evaluate a scope condition against a set of tool call arguments.
 *
 * Returns true if ALL defined conditions are satisfied:
 *   - paths: every present path-like arg matches at least one glob
 *   - args: every listed field has a value in the allowed list
 *   - argPatterns: every listed field's value matches the regex
 *
 * Returns false if any condition fails, or if a `paths` condition is
 * defined but the tool call carries no path-like argument fields.
 */
export function evaluateScope(
  scope: ScopeCondition,
  toolArgs: Record<string, unknown>,
): boolean {
  // ── paths condition ──────────────────────────────────────────
  if (scope.paths !== undefined && scope.paths.length > 0) {
    const pathValues = PATH_ARG_FIELDS
      .map((f) => toolArgs[f])
      .filter((v): v is string => typeof v === 'string');

    // If no path fields exist in the args, the condition cannot be
    // satisfied — treat as no-match rather than silently passing.
    if (pathValues.length === 0) return false;

    // Every path value must match at least one glob in the list.
    for (const p of pathValues) {
      // Normalise: strip leading ./ so patterns like 'src/**' match './src/foo'
      const normalised = p.startsWith('./') ? p.slice(2) : p;
      if (!picomatch.isMatch(normalised, scope.paths, { dot: true })) {
        return false;
      }
    }
  }

  // ── args condition (exact match) ─────────────────────────────
  if (scope.args !== undefined) {
    for (const [field, allowed] of Object.entries(scope.args)) {
      const val = toolArgs[field];
      if (typeof val !== 'string' || !allowed.includes(val)) return false;
    }
  }

  // ── argPatterns condition (regex match) ──────────────────────
  if (scope.argPatterns !== undefined) {
    for (const [field, pattern] of Object.entries(scope.argPatterns)) {
      const val = toolArgs[field];
      if (typeof val !== 'string') return false;
      try {
        if (!new RegExp(pattern).test(val)) return false;
      } catch {
        // Invalid regex — treat as no-match
        return false;
      }
    }
  }

  return true;
}

/**
 * Evaluate an ordered rules list against tool call arguments.
 *
 * Returns the mode of the first matching rule, or `undefined` if no
 * rule matches (allowing fall-through to the next policy level).
 */
export function evaluateRules(
  rules: AuthRule[],
  toolArgs: Record<string, unknown>,
): AuthorizationPolicy | undefined {
  for (const rule of rules) {
    if (rule.scope === undefined) {
      // No scope — catch-all rule, always matches
      return rule.mode;
    }
    if (evaluateScope(rule.scope, toolArgs)) {
      return rule.mode;
    }
  }
  return undefined;
}

/**
 * Evaluate a single ToolPolicy against tool call arguments.
 *
 * Returns the resolved AuthorizationPolicy, or `undefined` if the
 * policy is a rules list and no rule matched (fall-through).
 */
export function evaluatePolicy(
  policy: ToolPolicy,
  toolArgs: Record<string, unknown>,
): AuthorizationPolicy | undefined {
  if ('mode' in policy) {
    // Simple form — always matches
    return policy.mode;
  }
  // Rules form — first match wins
  return evaluateRules(policy.rules, toolArgs);
}

// ============================================================
// Policy resolution
// ============================================================

/**
 * Resolve the effective authorization policy for a tool call.
 *
 * Resolution order (first non-undefined result wins):
 *   1. Participant's per-tool policy (ToolPolicy — simple or rules)
 *   2. Engine-level per-tool policy (flat AuthorizationPolicy string)
 *   3. Engine-level default policy
 *   4. Built-in default for the tool (DEFAULT_TOOL_POLICIES)
 *   5. Global fallback: 'requires_approval'
 *
 * @param toolName             - The tool being called
 * @param toolArgs             - The arguments to the tool call
 * @param participantPolicies  - Per-tool policies from the participant's config
 * @param enginePolicies       - Engine-level per-tool overrides (simple modes only)
 * @param engineDefaultPolicy  - Engine-level default mode
 */
export function resolvePolicy(
  toolName: string,
  toolArgs: Record<string, unknown>,
  participantPolicies?: Record<string, ToolPolicy>,
  enginePolicies?: Record<string, AuthorizationPolicy>,
  engineDefaultPolicy?: AuthorizationPolicy,
): AuthorizationPolicy {
  // 1. Participant per-tool policy
  const participantPolicy = participantPolicies?.[toolName];
  if (participantPolicy !== undefined) {
    const result = evaluatePolicy(participantPolicy, toolArgs);
    if (result !== undefined) return result;
    // Rules list with no match — fall through
  }

  // 2. Engine per-tool policy
  if (enginePolicies?.[toolName]) {
    return enginePolicies[toolName];
  }

  // 3. Engine default policy
  if (engineDefaultPolicy !== undefined) {
    return engineDefaultPolicy;
  }

  // 4. Built-in default
  const builtin = DEFAULT_TOOL_POLICIES[toolName];
  if (builtin !== undefined) {
    return builtin;
  }

  // 5. Global fallback
  return 'requires_approval';
}
