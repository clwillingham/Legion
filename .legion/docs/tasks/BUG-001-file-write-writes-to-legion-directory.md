# BUG-001: file_write Writes to .legion/ Instead of Workspace Root

**Status**: RESOLVED

**Severity**: High (user-facing file operations create files in the wrong location)

**Resolved by**: Adding `workspaceRoot: string` to `RuntimeContext`; fixing all file tools to use `context.workspaceRoot` instead of `context.storage.resolve('.')` / `process.cwd()`.

---

## Summary

The `file_write` tool (and likely other file tools like `file_read`, `file_append`, `file_edit`, etc.) resolves workspace-relative paths against `.legion/` instead of the workspace root. When a user requests `file_write` with `path: "test.txt"`, the file is created at `.legion/test.txt` rather than `./test.txt` (workspace root).

This breaks the documented behavior where "paths are relative to the workspace root" and violates user expectations that file tools operate on the actual workspace.

---

## Symptoms

**Observable Behavior**:
- User calls `file_write` with `path: "README.md"` and content `"Hello"`
- File is created at `.legion/README.md` instead of `./README.md`
- User cannot write files to their actual workspace
- User cannot write files outside `.legion/` without using absolute paths (which are rejected by security checks)

**Current Evidence**:
- `.legion/test.txt` exists in the repository containing `"hello world"` (11 bytes)
- This is an artifact from testing the `file_write` tool and proves the bug is reproducible
- File tools' documentation claims paths are "relative to the workspace root" — contradicted by actual behavior

---

## Root Cause

The bug stems from how `RuntimeContext.storage` is constructed and used in file tools.

### Chain of Root Causes

1. **In `Workspace.ts` (constructor)**:
   ```typescript
   this.storage = new Storage(resolve(this.root, '.legion'));
   ```
   - `storage` is intentionally scoped to `.legion/` for Legion's internal persistence
   - `this.root` is the actual workspace root (e.g., `/home/user/my-project`)

2. **In `REPL.ts` (line ~679) and file tool initialization**:
   ```typescript
   storage: this.workspace.storage,
   ```
   - `RuntimeContext.storage` is set to `workspace.storage`
   - This puts the `.legion/` scope directly into the runtime context

3. **In `file-write.ts` (line ~51)**:
   ```typescript
   const workspaceRoot = context.storage.resolve('.');
   ```
   - File tools use `context.storage.resolve('.')` to get the "workspace root"
   - But `context.storage` is scoped to `.legion/`, so `resolve('.')` returns the `.legion/` directory path
   - All subsequent path resolution happens relative to `.legion/`

### Why This Is Wrong

- `context.storage` is a legitimate Legion abstraction for internal persistence
- It should NOT be conflated with the workspace root for user-facing file operations
- File tools need access to the actual workspace root (`workspace.root`), not a storage-scoped view of it

### Design Intent vs. Implementation

- **Intended**: File tools operate on workspace root; Legion internals use `.legion/`
- **Actual**: File tools operate on `.legion/`; security checks still validate against the (incorrectly resolved) workspace root

---

## Affected Files

### Direct Impact (Bug Manifestation)

- **`packages/core/src/tools/file-write.ts`** (line 51)
  - `const workspaceRoot = context.storage.resolve('.');`
  - Incorrectly resolves workspace root from storage context

- **`packages/core/src/tools/file-read.ts`** (likely)
  - Probably has the same bug (needs verification)

- **`packages/core/src/tools/file-tools.ts`** (likely)
  - Other file utilities (`file_append`, `file_edit`, `file_delete`, etc.) probably affected

### Root Cause (Architecture)

- **`packages/core/src/workspace/Workspace.ts`** (constructor, line ~50)
  - Correctly scopes `storage` to `.legion/`
  - Missing: no `workspaceRoot` field passed to `RuntimeContext`

- **`packages/core/src/runtime/ParticipantRuntime.ts`**
  - `RuntimeContext` interface has `storage: Storage` but no `workspaceRoot: string`
  - File tools have no way to access the actual workspace root

- **`packages/cli/src/repl/REPL.ts`** (line ~679)
  - `RuntimeContext` initialization only provides `storage`, not `workspaceRoot`

---

## Proposed Fix

### Solution: Add `workspaceRoot` to `RuntimeContext`

Add a `workspaceRoot: string` field to the `RuntimeContext` interface that holds the actual workspace root path. This keeps concerns separated:

- `storage`: Legion's internal `.legion/` scoped persistence (for collective, sessions, config)
- `workspaceRoot`: The actual workspace root for user-facing file operations

### Implementation Strategy

1. **Modify `RuntimeContext` interface** (`packages/core/src/runtime/ParticipantRuntime.ts`):
   - Add `workspaceRoot: string` field
   - Document that this is the workspace root, distinct from `storage` (which is `.legion/` scoped)

2. **Update REPL initialization** (`packages/cli/src/repl/REPL.ts`):
   - Pass `workspaceRoot: this.workspace.root` when constructing `RuntimeContext`

3. **Fix file tools** (`packages/core/src/tools/file-*.ts`):
   - Replace `context.storage.resolve('.')` with `context.workspaceRoot` in:
     - `file-write.ts`
     - `file-read.ts`
     - `file-append.ts`
     - `file-edit.ts`
     - `file-delete.ts`
     - `file-move.ts`
     - `file-search.ts`
     - `file-analyze.ts`
     - `directory-list.ts`
     - `file-grep.ts`

4. **Verify security checks**:
   - Ensure path validation still correctly prevents directory traversal attacks
   - Validate that absolute paths are rejected (or allowed only if they remain within workspace)

### Why This Fix Is Clean

- ✅ Preserves the intended separation: `storage` for Legion internals, `workspaceRoot` for user operations
- ✅ No changes to file tool logic — only the base path changes
- ✅ No coupling between file tools and `Storage` internals
- ✅ Makes the contract explicit in the `RuntimeContext` interface
- ✅ Minimal risk: straightforward path replacement

---

## Evidence

### Artifact: `.legion/test.txt`

```bash
$ ls -la .legion/test.txt
-rw-r--r-- 1 user user 11 Jan 15 10:30 .legion/test.txt

$ cat .legion/test.txt
hello world
```

This file:
- Was created by testing `file_write` with `path: "test.txt"` and `content: "hello world"`
- Should not exist in `.legion/` under normal operation
- Proves the bug is reproducible and real
- Should be removed once the bug is fixed

### Reproducible Test Case

```
1. Start Legion REPL
2. Call: file_write(path: "test-output.txt", content: "test")
3. Expected: ./test-output.txt is created
4. Actual: .legion/test-output.txt is created
```

---

## Related Issues

- May affect other file tools beyond `file_write` (needs audit)
- `process_exec` may have similar issues if it uses relative paths

---

## Notes for Reviewers

- The separation between `storage` and `workspaceRoot` is architecturally sound — don't merge them
- Security checks (path validation) should remain; they just need to validate against the correct root
- Existing code using `storage` for Legion internals should not be affected by this fix
