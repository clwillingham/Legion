import { z } from 'zod';
import { AuthRuleSchema, evaluateRules } from './policies.js';

// ============================================================
// Approval Permission — per-tool entry in an authority config
// ============================================================

/**
 * How much approval authority a participant has for a specific tool:
 *
 * - `true`          → Can always approve this tool (unconditional).
 * - `{ rules: [] }` → Can approve this tool when the scoped rules match.
 *                     Uses the same AuthRule syntax as ToolPolicy rules form.
 *                     If a rule matches with mode 'auto', the caller CAN approve.
 *                     If mode 'deny', the caller CANNOT approve.
 *                     If no rule matches, the caller CANNOT approve.
 */
export const ApprovalPermissionSchema = z.union([
  z.literal(true),
  z.object({ rules: z.array(AuthRuleSchema).min(1) }),
]);

export type ApprovalPermission = z.infer<typeof ApprovalPermissionSchema>;

// ============================================================
// Approval Authority Entry — per requesting-participant map
// ============================================================

/**
 * A per-requesting-participant authority entry. Two forms:
 *
 * Simple form (backward compatible):
 *   `string[]` — a list of tool names the approver can unconditionally approve.
 *   Example: `["file_read", "file_write", "process_exec"]`
 *
 * Rules form:
 *   A record keyed by tool name (or `'*'` for any tool), mapping to an
 *   `ApprovalPermission` (either `true` for unconditional, or `{ rules }` for scoped).
 *   Example: `{ "file_write": true, "file_delete": { rules: [...] } }`
 */
export const ApprovalAuthorityEntrySchema = z.union([
  z.array(z.string()),             // Simple: ["file_read", "file_write"]
  z.record(ApprovalPermissionSchema), // Rules: { "file_write": true, ... }
]);

export type ApprovalAuthorityEntry = z.infer<typeof ApprovalAuthorityEntrySchema>;

// ============================================================
// Approval Authority — top-level config on a participant
// ============================================================

/**
 * Declares the approval authority of a participant: which tool calls
 * (from which other participants) they are allowed to grant or deny.
 *
 * Three forms:
 *
 * - `'*'` — Can approve ANYTHING from ANYONE. Full trust.
 *
 * - Record with simple array values (backward compatible):
 *   ```json
 *   { "coding-agent": ["file_read", "file_write"] }
 *   ```
 *
 * - Record with rules-form values (full scoped authority):
 *   ```json
 *   { "coding-agent": { "file_write": true, "file_delete": { "rules": [...] } } }
 *   ```
 *
 * Keys are requesting participant IDs; use `'*'` to match any participant.
 */
export const ApprovalAuthoritySchema = z.union([
  z.literal('*'),
  z.record(ApprovalAuthorityEntrySchema),
]);

export type ApprovalAuthority = z.infer<typeof ApprovalAuthoritySchema>;

// ============================================================
// hasAuthority — check if a participant can approve a tool call
// ============================================================

/**
 * Determine whether a participant holding `authority` is allowed to
 * approve a tool call made by `requestingParticipantId`.
 *
 * Resolution order:
 * 1. `'*'` at the top level → YES for everything.
 * 2. Look up an entry for `requestingParticipantId`, falling back to `'*'`.
 * 3. Within that entry, look up the `toolName`, falling back to `'*'`.
 * 4. `true`       → YES (unconditional).
 * 5. `{ rules }`  → evaluate rules — YES if the matching rule has mode `'auto'`.
 * 6. No entry     → NO.
 *
 * @param authority            The approver's approvalAuthority config.
 * @param requestingParticipantId  The participant who wants to run the tool.
 * @param toolName             The tool being requested.
 * @param toolArgs             The arguments for the tool call (used for scoping).
 */
export function hasAuthority(
  authority: ApprovalAuthority,
  requestingParticipantId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
): boolean {
  // Wildcard authority — can approve everything
  if (authority === '*') {
    return true;
  }

  // Find the most specific entry for the requesting participant
  const entry =
    authority[requestingParticipantId] ??
    authority['*'];

  if (!entry) {
    return false;
  }

  // Simple array form — list of tool names, all unconditional
  if (Array.isArray(entry)) {
    return entry.includes(toolName);
  }

  // Rules form — look up by tool name with '*' fallback
  const permission = entry[toolName] ?? entry['*'];

  if (!permission) {
    return false;
  }

  // Unconditional approval
  if (permission === true) {
    return true;
  }

  // Scoped rules: evaluate and check if the result is 'auto'
  const policyMode = evaluateRules(permission.rules, toolArgs);
  return policyMode === 'auto';
}
