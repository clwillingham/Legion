# Phase 3: Authorization & Approval — Design & Implementation Plan

**Created: March 2, 2026**
**Prerequisite: Phase 2 complete (all milestones 2.1–2.4)**

---

## Overview

Phase 3 transforms Legion's authorization from a flat "auto / requires_approval / deny" system into a granular, delegated, and auditable system. The three milestones are ordered by practical value:

| Milestone | Scope | Priority |
|---|---|---|
| **3.1 Granular Scoping** | Tool policies evaluate args (paths, targets, commands) to decide mode | Highest — immediate daily value |
| **3.2 Approval Logging** | Persist every approval decision for auditability | High — complements scoping |
| **3.3 Approval Authority Delegation** | Calling participants approve/reject tool calls for downstream agents | Medium — needed for sophisticated multi-agent workflows |

---

## Current State

### What exists today

- **`AuthEngine`** — checks policies, delegates to an `ApprovalHandler` callback for `requires_approval` tools
- **`ToolPolicy`** schema — `{ mode: 'auto' | 'requires_approval', scope?: Record<string, unknown> }` — scope field exists but is **never evaluated**
- **`approvalAuthority`** field on all participants — `Record<string, string[]> | '*'` — exists in schema but is **never enforced**
- **`ApprovalRequest`** type — captures tool call details, used transiently during approval flow, **never persisted**
- **Resolution order**: participant policy → engine-level policy → built-in defaults → global fallback (`requires_approval`)
- **Only approver**: the user, via CLI `ApprovalPrompt`

### What needs to change

1. **Scope evaluation** — `resolvePolicy()` must inspect tool args against scope rules, not just look up mode by tool name
2. **Approval persistence** — decisions must be written to disk with full context
3. **Delegation chain** — approval requests must route through the communication chain, not just to the user

---

## Milestone 3.1: Granular Scoping

### Goal

Tool policies can match on arguments — not just tool name — to decide whether a call is `auto`, `requires_approval`, or `deny`. This enables patterns like:

- Auto-approve `file_read` in `src/**` but require approval for `.env*`
- Auto-approve `process_exec` for `npm test` but require approval for `rm`
- Auto-approve `communicate` to `qa-agent` but require approval for `user`

### Core Schema: Rules List

The key design principle is a **reusable rules-list pattern**. Both tool policies and approval authority use the same building blocks: an ordered list of rules, each with a `mode` and an optional `scope`. The first matching rule wins.

#### Scope Conditions

```typescript
const ScopeConditionSchema = z.object({
  /** Glob patterns for path-based args (path, cwd, destination, etc.) */
  paths: z.array(z.string()).optional(),

  /** Allowed values for specific string args (e.g. communicate target) */
  args: z.record(z.array(z.string())).optional(),

  /** Regex patterns for string arg matching */
  argPatterns: z.record(z.string()).optional(),
});
```

#### Authorization Rule

```typescript
const AuthRuleSchema = z.object({
  /** What to do when this rule matches */
  mode: z.enum(['auto', 'requires_approval', 'deny']),

  /** Conditions to match against tool args. If omitted, the rule matches everything (catch-all). */
  scope: ScopeConditionSchema.optional(),
});
```

#### Tool Policy (updated)

A tool policy is either a simple mode (backward compatible) or an ordered rules list:

```typescript
const ToolPolicySchema = z.union([
  // Simple form — no scoping, just a mode (existing behavior preserved)
  z.object({ mode: z.enum(['auto', 'requires_approval', 'deny']) }),

  // Rules form — ordered list, first match wins
  z.object({ rules: z.array(AuthRuleSchema) }),
]);
```

The simple `{ mode: 'auto' }` form is sugar for `{ rules: [{ mode: 'auto' }] }` — a single catch-all rule.

### Policy Configuration Examples

```json
{
  "tools": {
    "file_read": {
      "rules": [
        { "mode": "deny", "scope": { "paths": [".env*", "**/.git/**"] } },
        { "mode": "auto", "scope": { "paths": ["src/**", "docs/**", "*.md"] } },
        { "mode": "requires_approval" }
      ]
    },
    "file_write": {
      "rules": [
        { "mode": "deny", "scope": { "paths": ["node_modules/**", ".env*"] } },
        { "mode": "auto", "scope": { "paths": ["src/**", "test/**"] } },
        { "mode": "requires_approval" }
      ]
    },
    "process_exec": {
      "rules": [
        { "mode": "auto", "scope": { "argPatterns": { "command": "^(npm (test|run lint|run build)|node )" } } },
        { "mode": "requires_approval" }
      ]
    },
    "communicate": {
      "rules": [
        { "mode": "auto", "scope": { "args": { "target": ["coding-agent", "qa-agent"] } } },
        { "mode": "requires_approval" }
      ]
    }
  }
}
```

Rules evaluate top-to-bottom:
- `file_read` to `.env*` → **denied** (rule 1 matches)
- `file_read` to `src/utils.ts` → **auto** (rule 2 matches)
- `file_read` to `config/secrets.json` → **requires_approval** (rules 1-2 miss, catch-all rule 3)

### Rules Evaluation Logic

When a tool call comes in:

1. Look up the tool's policy by name from participant config
2. If the policy is simple (`{ mode }`) → return the mode (existing behavior)
3. If the policy has `rules` → evaluate each rule in order:
   - Rule has `scope` → evaluate scope against tool args
     - Scope matches → return this rule's `mode`
     - Scope doesn't match → try next rule
   - Rule has no `scope` → matches everything (catch-all), return `mode`
4. If no rule matches → fall through to engine default → built-in default → `requires_approval`

```
resolvePolicy(toolName, args, participantPolicies, enginePolicies, builtinDefaults)
  → participant policy for tool?
    → simple mode? → return mode
    → rules list? → evaluate rules in order, first match wins
    → no match? → fall through
  → engine policy? → (same rules logic)
  → built-in default? → return it
  → global fallback → 'requires_approval'
```

### Scope Matching Details

#### Path Matching (`paths`)

- Extract path-like arguments from tool args (field name varies by tool)
- Tool-specific arg mapping: `file_read` → `path`, `file_write` → `path`, `process_exec` → `cwd`, `file_move` → `source` + `destination`
- Match against `paths` globs using picomatch
- Paths are relative to workspace root; absolute paths are resolved relative to workspace
- For multi-path tools (`file_move`), **all** path args must match for the scope to match

#### Arg Matching (`args`)

- Exact match: the arg value must be in the allowed list (case-sensitive)
- Example: `{ "args": { "target": ["coding-agent", "qa-agent"] } }` — only matches if `target` is one of those values

#### Pattern Matching (`argPatterns`)

- Regex match: the arg value must match the pattern
- Example: `{ "argPatterns": { "command": "^npm " } }` — only matches commands starting with `npm `

#### Combining Conditions

All conditions within a scope are **ANDed** — every condition must pass for the scope to match. This allows fine-grained rules like "auto-approve `process_exec` in `src/` when the command starts with `npm`":

```json
{ "mode": "auto", "scope": { "paths": ["src/**"], "argPatterns": { "command": "^npm " } } }
```

### Implementation Steps

1. **Define `ScopeConditionSchema` + `AuthRuleSchema`** in `policies.ts`
2. **Update `ToolPolicySchema`** — union of simple mode and rules-list form; add `deny` mode
3. **Add `evaluateScope()` function** — takes scope + tool args, returns `boolean` (match/no-match)
4. **Add `evaluateRules()` function** — takes rules list + tool args, returns resolved mode or `undefined` (no match)
5. **Update `resolvePolicy()` signature** — add `args` parameter, handle both simple and rules-list policies
6. **Update `AuthEngine.authorize()`** — pass args through to `resolvePolicy()`
7. **Update `ToolExecutor.execute()`** — already passes args, no change needed
8. **Add path matching utility** — install picomatch, workspace-relative glob matching
9. **Handle multi-path tools** — `file_move` has both `source` and `destination`; all must match
10. **Backward compatibility** — existing simple `{ mode: 'auto' }` policies continue to work unchanged
11. **Tests** — rules evaluation order, scope matching, path globs, arg matching, fall-through, backward compat

### Dependency Decision: Glob Matching

Options:
- **picomatch** (0 deps, 18KB, fast) — recommended
- **micromatch** (uses picomatch internally, adds features we don't need)
- **minimatch** (heavier, older API)
- **Custom** — simple `*` and `**` matching (fragile)

Recommend: **picomatch** — it's what micromatch uses internally, zero dependencies, well-tested.

---

## Milestone 3.2: Approval Logging

### Goal

Every approval decision (approve, reject, auto-approve, deny) is persisted with full context, queryable per session.

### Storage Structure

```
.legion/sessions/<session-id>/
├── session.json
├── conversations/
│   ├── user__ur-agent.json
│   └── ...
└── approvals/
    ├── approval_1709330000000_a1b2c3.json
    ├── approval_1709330005000_d4e5f6.json
    └── ...
```

Each approval record is an individual JSON file named by its request ID. This avoids concurrent-write issues and makes records individually addressable.

### Approval Record Schema

```typescript
const ApprovalRecordSchema = z.object({
  /** Unique approval ID (matches ApprovalRequest.id) */
  id: z.string(),

  /** Session this occurred in */
  sessionId: z.string(),

  /** The participant whose tool call triggered this */
  requestingParticipantId: z.string(),

  /** The participant who made the approval decision */
  decidedByParticipantId: z.string(),

  /** The tool that was called */
  toolName: z.string(),

  /** The arguments to the tool call */
  toolArguments: z.record(z.unknown()),

  /** What happened */
  decision: z.enum(['approved', 'rejected', 'auto_approved', 'denied']),

  /** The policy that was evaluated */
  policyMode: z.enum(['auto', 'requires_approval', 'deny']),

  /** Whether scope rules affected the decision */
  scopeEvaluated: z.boolean(),

  /** Optional reason (provided by the approver on reject, or system-generated) */
  reason: z.string().optional(),

  /** When the request was created */
  requestedAt: z.string(),

  /** When it was resolved */
  resolvedAt: z.string(),

  /** Duration in milliseconds (from request to resolution) */
  durationMs: z.number(),
});
```

### Implementation Steps

1. **Define `ApprovalRecordSchema`** in a new `ApprovalLog.ts` file (or extend `ApprovalRequest.ts`)
2. **Create `ApprovalLog` class** — handles persistence
   - `record(entry: ApprovalRecord): Promise<void>` — writes a single record
   - `list(filter?: { participantId?, toolName?, decision?, limit? }): Promise<ApprovalRecord[]>` — reads and filters
   - `get(id: string): Promise<ApprovalRecord | undefined>` — single lookup
3. **Wire into `AuthEngine`** — after every authorization decision (approve, reject, auto, deny), persist a record
4. **Storage scoping** — `ApprovalLog` receives a `Storage` instance scoped to `sessions/<id>/approvals/`
5. **Add `auto_approved` and `denied` decisions** — currently these are silent; they should be logged too
6. **Add REPL command** — `/approvals [n]` to view recent approval decisions in the current session
7. **Add collective tool** — `list_approvals` tool for agents to query approval history
8. **Tests** — record persistence, filtering, querying

### Auto-approve and Deny Logging

Currently, `auto` and `deny` decisions happen silently in `resolvePolicy()` — they never reach the approval handler. To log these:

- `AuthEngine.authorize()` already knows the resolved policy
- After resolving, create and persist an `ApprovalRecord` with `decision: 'auto_approved'` or `decision: 'denied'`
- These records use `decidedByParticipantId: 'system'` since no participant made the decision

---

## Milestone 3.3: Approval Authority Delegation

### Goal

When an agent's tool call requires approval, the **calling participant** (the one who initiated the conversation via `communicate`) handles the approval inline. The approval request surfaces as a tool result in the calling agent's conversation, and the conversation pauses until resolved.

### Design: Caller-Approves Pattern

This is the primary delegation model. It's token-efficient and keeps the approval flow contained within the existing communication chain:

```
User → UR Agent → Coding Agent
                       │
                       ├─ Coding Agent calls file_write (requires_approval)
                       │
                       ├─ Conversation pauses
                       │
                       ├─ UR Agent receives tool result: { status: 'approval_required', ... }
                       │
                       ├─ UR Agent decides:
                       │    • Has approval authority? → approve/reject inline
                       │    • No authority? → escalate (return approval_required up the chain)
                       │
                       ├─ Decision flows back down → file_write executes (or is rejected)
                       │
                       └─ Conversation resumes with the tool result (or next approval request)
```

### How It Works

#### Step 1: Tool call requires approval

`ToolExecutor` detects `requires_approval`. Instead of immediately calling the `ApprovalHandler`:

1. Check if the **calling participant** (from `RuntimeContext.callingParticipantId`) has `approvalAuthority` for this tool
2. If yes → the approval request is returned to the calling participant's runtime as part of the conversation response
3. If no → escalate up the chain (recursively, until someone has authority or we reach the user)

#### Step 2: Approval surfaces in the calling agent's conversation

The `communicate` tool call that Agent A used to talk to Agent B returns a special result:

```typescript
{
  status: 'approval_required',
  data: {
    requestId: 'approval_...',
    requestingParticipant: 'coding-agent',
    toolName: 'file_write',
    arguments: { path: 'src/auth.ts', content: '...' },
    // The calling agent can approve or reject via a tool
  }
}
```

#### Step 3: Calling agent responds

The calling agent (or user) uses an `approve_request` / `reject_request` tool:

```typescript
// approve_request tool
{
  name: 'approve_request',
  parameters: {
    requestId: string,
    reason?: string,
  }
}

// reject_request tool
{
  name: 'reject_request',
  parameters: {
    requestId: string,
    reason?: string,
  }
}
```

Once resolved:
- The downstream tool executes (or is rejected)
- The paused conversation resumes
- The `communicate` tool returns the conversation result (which may include another approval request if more tools need approval)

#### Step 4: Escalation (natural, via maxDepth)

If the calling participant doesn't have `approvalAuthority` for the requested tool, the approval request is returned as the conversation response. The calling participant's own caller then sees it, and so on up the chain. This is not a special mechanism — it's the normal conversation return flow.

Since conversations are bounded by `maxDepth`, the escalation naturally terminates. The user at the top of the chain always has `'*'` authority and can resolve any request. No explicit cycle detection is needed.

### `approvalAuthority` Semantics (updated)

The `approvalAuthority` field uses the same **rules-list pattern** as tool policies. This allows scoped approval — e.g., UR Agent can approve `file_write` in `src/**` but must escalate `file_write` to `.env`.

#### Schema

```typescript
const ApprovalAuthoritySchema = z.union([
  // Blanket authority — can approve anything for anyone
  z.literal('*'),

  // Per-participant authority with scoped rules
  z.record(                          // keyed by participant ID (or '*' for any participant)
    z.union([
      z.array(z.string()),           // Simple form: list of tool names (backward compatible)
      z.record(                      // Rules form: keyed by tool name
        z.union([
          z.literal(true),           // Can approve this tool unconditionally
          z.object({                 // Can approve this tool with scope conditions
            rules: z.array(AuthRuleSchema),
          }),
        ]),
      ),
    ]),
  ),
]);
```

#### Examples

```json
// User: can approve anything
"approvalAuthority": "*"

// UR Agent: simple per-participant tool list (backward compatible)
"approvalAuthority": {
  "coding-agent": ["file_read", "file_write", "process_exec"],
  "qa-agent": ["file_read", "process_exec"]
}

// UR Agent: scoped authority (rules form)
"approvalAuthority": {
  "coding-agent": {
    "file_read": true,
    "file_write": {
      "rules": [
        { "mode": "auto", "scope": { "paths": ["src/**", "test/**"] } },
        { "mode": "deny" }
      ]
    },
    "process_exec": {
      "rules": [
        { "mode": "auto", "scope": { "argPatterns": { "command": "^npm " } } },
        { "mode": "deny" }
      ]
    }
  }
}

// Agent with no approval authority
"approvalAuthority": {}
```

In the scoped rules form, the `mode` values mean:
- `auto` — scope matches → the calling agent can approve this without further escalation
- `deny` — scope matches → the calling agent cannot approve; escalate up the chain
- `requires_approval` — not meaningful here (this is the authority check, not the policy check)

#### Authority Resolution

```
hasAuthority(approverId, requestingParticipantId, toolName, toolArgs)
  → authority is '*'? → YES
  → authority has entry for requestingParticipantId (or '*')?
    → simple array? → toolName in array? → YES
    → rules record? → tool entry exists?
      → true? → YES (unconditional)
      → { rules }? → evaluate rules against toolArgs, first match wins
        → mode 'auto' → YES
        → mode 'deny' → NO
    → no entry for tool → NO
  → no entry for participant → NO
```

### Escalation Chain

```
Coding Agent calls file_write({ path: 'src/auth.ts' }) — requires_approval
  → Check: does UR Agent have authority for coding-agent/file_write in src/**?
    → YES (scoped rule matches): return approval_required to UR Agent's agentic loop
      → UR Agent calls approve_request or reject_request
      → file_write executes or is rejected
      → communicate returns result

Coding Agent calls file_write({ path: '.env' }) — requires_approval
  → Check: does UR Agent have authority for coding-agent/file_write to .env?
    → NO (deny rule matches): approval_required propagates up
      → User sees the request via ApprovalHandler
      → User approves/rejects
      → Result flows back down the chain
```

### Implementation Steps

1. **Add `callingParticipantId` to `RuntimeContext`** — tracks who initiated the current communication
2. **Add `approve_request` and `reject_request` tools** — registered globally, usable by any participant with approval authority
3. **Add `hasAuthority()` function** — evaluates `approvalAuthority` (supports `'*'`, simple arrays, and scoped rules)
4. **Modify `ToolExecutor`** — when `requires_approval`, check calling participant's authority before falling back to `ApprovalHandler`
5. **Add `PendingApproval` registry** — tracks pending approval requests waiting for resolution
6. **Modify `Conversation.send()`** — support pausing mid-conversation for approval and resuming after
7. **Modify `communicate` tool** — return `approval_required` status when downstream tool needs approval; natural escalation via `maxDepth`
8. **Update `ApprovalAuthoritySchema`** — support scoped rules form alongside simple form
9. **Tests** — caller approves, caller rejects, scoped authority, escalation to user, multi-level delegation

### Open Questions for 3.3

These should be resolved during implementation:

1. **Multiple pending approvals** — if Agent B makes 3 tool calls that all need approval, does Agent A see them one at a time (conversation pauses after each) or batched?
   - **Recommended**: One at a time. The conversation pauses after the first `requires_approval` tool call, resumes after resolution. If the next iteration also hits `requires_approval`, it pauses again. This is simpler and matches how the agentic loop already works (it processes tool calls sequentially per iteration, but LLMs can request parallel tool calls).

2. **Approval timeout** — should approval requests expire?
   - **Recommended**: Not initially. The conversation just stays paused. Add timeouts in a future phase if needed.

3. **Partial authority** — Agent A has authority over `file_read` but not `file_write` for Agent B. Agent B calls `file_write`. Does Agent A see the request (and must escalate) or does it bypass Agent A entirely?
   - **Recommended**: Agent A sees it. Since it lacks authority, the `approval_required` result propagates up through the normal conversation return. Agent A doesn't need to explicitly "escalate" — it just returns the result, and its caller handles it (or returns it further up). The `maxDepth` limit ensures natural termination.

---

## Cross-Cutting Concerns

### Event System Updates

New events for Phase 3:

```typescript
// Scope evaluation result
type ScopeEvaluatedEvent = {
  type: 'authorization:scope_evaluated';
  participantId: string;
  toolName: string;
  scopeMatched: boolean;
  resolvedMode: AuthorizationPolicy;
};

// Approval logged
type ApprovalLoggedEvent = {
  type: 'approval:logged';
  recordId: string;
  decision: 'approved' | 'rejected' | 'auto_approved' | 'denied';
};

// Approval escalated
type ApprovalEscalatedEvent = {
  type: 'approval:escalated';
  requestId: string;
  fromParticipantId: string;
  toParticipantId: string;
};
```

### Config Schema Updates

Add workspace-level authorization config:

```json
{
  "authorization": {
    "defaultPolicy": "requires_approval",
    "logAutoApprovals": true,
    "logDenials": true
  }
}
```

### REPL Updates

- `/approvals [n]` — view recent approval decisions (Milestone 3.2)
- Display approval escalation events in real-time (Milestone 3.3)

---

## Implementation Order

```
3.1  Granular Scoping
│
├── 1. ScopeConditionSchema + deny mode in ToolPolicySchema
├── 2. evaluateScope() function
├── 3. Path matching utility (picomatch)
├── 4. Update resolvePolicy() with args + scope evaluation
├── 5. Update AuthEngine.authorize() to pass args
├── 6. Arg matching (exact + regex)
├── 7. Multi-path tool handling (file_move)
├── 8. Update built-in defaults with sensible scopes
├── 9. Tests
│
3.2  Approval Logging
│
├── 1. ApprovalRecordSchema + ApprovalLog class
├── 2. Storage scoping for approvals/
├── 3. Wire ApprovalLog into AuthEngine (all decisions)
├── 4. Auto-approve and deny logging
├── 5. /approvals REPL command
├── 6. list_approvals collective tool
├── 7. Tests
│
3.3  Approval Authority Delegation
│
├── 1. Update ApprovalAuthoritySchema (scoped rules form)
├── 2. hasAuthority() function (evaluate all schema forms)
├── 3. callingParticipantId in RuntimeContext
├── 4. approve_request + reject_request tools
├── 5. PendingApproval registry
├── 6. ToolExecutor delegation logic
├── 7. Conversation pause/resume for approval
├── 8. communicate tool approval_required handling
├── 9. Tests
```

---

## Testing Strategy

### Milestone 3.1 Tests
- `evaluateScope()` — path glob matching, arg exact matching, argPatterns regex, AND logic across conditions
- `evaluateRules()` — ordered evaluation, first match wins, catch-all (no scope) rule, no match returns undefined
- `resolvePolicy()` — simple mode (backward compat), rules-list mode, scope match → use mode, no match → fall through
- Integration: `AuthEngine.authorize()` with scoped rules end-to-end
- Edge cases: missing args, empty scope, empty rules, overlapping globs, `**` patterns, multi-path tools

### Milestone 3.2 Tests
- `ApprovalLog.record()` — persists to correct path
- `ApprovalLog.list()` — filtering by participant, tool, decision
- `AuthEngine` integration — every decision type creates a record
- Edge cases: concurrent writes, empty session

### Milestone 3.3 Tests
- Caller with blanket authority (`'*'`) → approve/reject inline (MockRuntime)
- Caller with simple array authority → approve matching tool, escalate non-matching
- Caller with scoped rules authority → approve within scope, escalate outside scope
- Caller without authority → natural escalation to user via conversation return
- Multi-level: User → A → B → C, C needs approval, escalates through B to A
- `approve_request` / `reject_request` tools — valid requests, invalid request IDs, unauthorized caller
- Conversation pause/resume — messages are held, then continue after resolution
- `hasAuthority()` — all schema forms: `'*'`, simple arrays, scoped rules, `true` shorthand

---

## Risk & Complexity Assessment

| Milestone | Complexity | Risk | Notes |
|---|---|---|---|
| **3.1** | Medium | Low | Mostly new functions + updated signatures; existing tests validate no regression |
| **3.2** | Low | Low | Straightforward file I/O; mirrors existing Storage patterns |
| **3.3** | High | Medium | Requires modifying the conversation/communication flow; async pause/resume adds complexity; must not break existing approval behavior. No explicit cycle detection needed — `maxDepth` provides natural termination |

**Recommendation**: Implement 3.1 and 3.2 together (they're complementary and low-risk). Implement 3.3 separately with careful attention to the conversation pause/resume mechanism.
