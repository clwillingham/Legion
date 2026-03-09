# ADR 0001: File Writes Route Through the Tool Gateway

**Status:** Accepted  
**Date:** 2025-07-16  
**Task:** TASK-006 (Phase 4, Milestones 4.6/4.7 — Stream A, Step 1)

---

## Context

Two independent bugs combine to create a situation where file writes from the web UI bypass Legion's authorization engine entirely.

### Bug 1: `PUT /api/files/content` writes directly to disk

The route handler in `packages/server/src/routes/files.ts` uses Node's `fs` module to write file content directly, without invoking the tool system or the authorization engine. This means:

- `file_write` tool policies (`auto`, `requires_approval`, `deny`) are not evaluated
- Scope-based path restrictions in `authorization.toolPolicies` are not enforced
- The write is invisible to any audit or approval flow
- The behavior is inconsistent with how every other mutating operation in the web UI is handled (process management routes all go through `POST /api/tools/:name/execute`)

This is a violation of the system contract: the web UI is supposed to be a peer to agents, subject to the same policies. A direct-write route is not.

### Bug 2: `fileWriteTool` resolves paths against `process.cwd()`

`packages/core/src/tools/file-write.ts` calls `process.cwd()` to anchor relative file paths. This is incorrect because:

- `process.cwd()` reflects wherever the Legion process was started from, not the configured workspace root
- If Legion is started from a directory other than the workspace root (e.g., from `/` via a systemd unit, or from `~` via a shell alias), all relative path writes land in the wrong location
- The correct workspace root is available on `context.storage` — the `Storage` object carries a `basePath` and exposes a `resolve(filePath)` method that correctly anchors paths to the workspace

These two bugs are linked: fixing Bug 1 (routing through the tool gateway) only has value if Bug 2 is also fixed, because the tool gateway invokes `fileWriteTool.execute()`. A correctly-authorized call to a broken tool is still broken.

---

## Decision

### 1. `PUT /api/files/content` is replaced with `501 Not Implemented`

The write path of the `PUT /api/files/content` route is removed. The route handler returns HTTP `501 Not Implemented` with a body that directs callers to use `POST /api/tools/file_write/execute` instead.

The read endpoints (`GET /api/files/tree` and `GET /api/files/content`) are unaffected — reads do not require authorization and their direct-FS implementation is correct.

### 2. All web UI file writes go through `POST /api/tools/file_write/execute`

`FileEditor.vue` calls `useTools().execute('file_write', { path, content })`. This is identical in structure to how `useProcesses.startProcess()` calls `process_start` through the same tool gateway. The gateway handler in `toolRoutes.ts` already invokes `tool.execute(args, context)` via a properly constructed `RuntimeContext`, which wires up the authorization engine.

This means file write requests from the web UI are subject to the same policy evaluation as file write calls from agents:

- `mode: auto` → executes immediately, returns result
- `mode: requires_approval` → returns `approval_required` status, enters the approval queue
- `mode: deny` → returns `denied` status, write does not occur

### 3. `fileWriteTool` resolves paths via `context.storage.resolve()`

`packages/core/src/tools/file-write.ts` is fixed to anchor relative paths using `context.storage.resolve(filePath)` instead of `path.resolve(process.cwd(), filePath)`. This makes the tool workspace-aware regardless of the process working directory.

### 4. The web frontend handles `approval_required` as a valid non-error state

`FileEditor.vue` must treat an `approval_required` response from `useTools().execute()` as a success path, not an error. The appropriate UI response is a status message ("Save submitted — awaiting approval") rather than an error toast. This is consistent with how the approval flow works for process operations.

---

## Consequences

### Positive

- **Authorization is uniform.** File writes from the web UI obey the same `file_write` tool policies as file writes from agents. A workspace configured with `file_write: requires_approval` will require approval regardless of whether the write comes from an agent or a human using the file explorer.
- **No auth logic duplication.** The authorization engine lives in one place (the tool gateway + `authEngine`). There is no parallel implementation to maintain.
- **Workspace-correctness.** `fileWriteTool` now works correctly when Legion is started from any directory, not just the workspace root.
- **Audit consistency.** All file writes are visible to the same logging and approval infrastructure.

### Negative / Costs

- **`PUT /api/files/content` is a breaking change.** Any external caller relying on the direct-write endpoint will receive `501`. This is acceptable — the endpoint was never part of a stable public API and was introduced as part of the same Phase 4 work.
- **Save latency includes a round-trip through the tool gateway.** For `auto`-mode writes this is negligible (one additional function call). For `requires_approval` writes, the user must wait for human approval before the file is saved — this is the intended behavior.
- **`FileEditor.vue` must handle the `approval_required` response state.** This adds a non-trivial UI state to the editor component. It is necessary and should be treated as a feature, not an edge case.

---

## Alternatives Considered

### (a) Keep `PUT /api/files/content` but add auth middleware to it

Add an authorization check inside the existing `PUT /api/files/content` handler — validate the request against the `file_write` tool policy before writing.

**Rejected.** This duplicates the authorization logic that already exists in the tool gateway. The gateway's `tool.execute(args, context)` path is the canonical place where tool policies are evaluated. Building a parallel evaluation path in a route handler creates two code paths that must be kept in sync as the auth engine evolves. It also does not fix Bug 2 — the direct-FS write would still not use `fileWriteTool` at all, so path resolution would remain wrong.

### (b) Leave `fileWriteTool` using `process.cwd()`

Accept that `fileWriteTool` resolves paths from `process.cwd()` and document that Legion must be started from the workspace root.

**Rejected.** This is a fragile operational requirement that is easy to violate accidentally — a systemd unit, a shell alias, or a wrapper script can all change the working directory. The workspace root is already available on `context.storage` and was clearly intended to be used for exactly this purpose. There is no reason to rely on `process.cwd()` when the correct value is present in the execution context.
