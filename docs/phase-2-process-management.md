# Phase 2: Process Management

**Created: March 1, 2026**
**Based on: Legion Implementation Plan — Phase 2**

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Decisions](#2-design-decisions)
3. [Architecture](#3-architecture)
4. [Tool Specifications](#4-tool-specifications)
5. [Process Registry](#5-process-registry)
6. [Event System Extensions](#6-event-system-extensions)
7. [Configuration](#7-configuration)
8. [Authorization & Safety](#8-authorization--safety)
9. [CLI Integration](#9-cli-integration)
10. [Implementation Milestones](#10-implementation-milestones)
11. [Testing Strategy](#11-testing-strategy)
12. [Open Questions](#12-open-questions)

---

## 1. Overview

**Goal**: Give agents the ability to execute and manage shell processes — run tests, build projects, start dev servers, execute scripts, lint code, and interact with any CLI tool available on the system.

This unlocks the most impactful class of agent capabilities: agents that can actually *run* the code they write, verify their changes, and operate the development toolchain.

### Tools to Implement

| Tool | Purpose | Execution Model |
|---|---|---|
| `process_exec` | Run a command and wait for output | Synchronous (blocking) |
| `process_start` | Start a long-running background process | Asynchronous (non-blocking) |
| `process_status` | Check on a background process | Query |
| `process_stop` | Terminate a background process | Control |
| `process_list` | List all tracked background processes | Query |

### What This Enables

- **Run tests**: `npm test`, `vitest run src/tools/`, `pytest`
- **Build projects**: `npm run build`, `tsc --noEmit`, `make`
- **Start servers**: `npm run dev`, `docker compose up`
- **Lint & format**: `eslint src/`, `prettier --check .`
- **Version control**: `git status`, `git diff`, `git log`
- **System tools**: `curl`, `grep`, `find`, `wc`, package managers
- **Custom scripts**: Any user-defined script or tool

---

## 2. Design Decisions

### Shell Configuration

Default shell: `/bin/sh` (POSIX-compatible, most portable).

Configurable at the workspace level for projects that need bash, zsh, fish, or PowerShell features. The shell is resolved from:
1. Workspace config (`processManagement.shell`)
2. Global config (`defaults.processManagement.shell`)
3. Built-in default (`/bin/sh`)

### Output Handling

**Truncation with limits.** Commands can produce megabytes of output that would blow the LLM's context window. The default strategy:

- **Max output size**: 50KB (configurable)
- **Truncation behavior**: When output exceeds the limit, return the first ~20KB and last ~20KB with a `[... N bytes truncated ...]` marker in between
- Agents can also request specific byte/line ranges from stored output using `process_status`

All process output (stdout + stderr) is captured and stored in memory for the session's lifetime, enabling agents to retrieve it later.

### Process Lifecycle

- **Session-scoped**: All background processes are automatically killed when the session ends (SIGTERM, then SIGKILL after 5s grace period)
- **Configurable concurrency limit**: Default 10 concurrent background processes per session. Can be changed or disabled (set to 0) via config
- **Process IDs**: Simple incrementing integers per session (1, 2, 3...) — no UUIDs. Agents need to reference processes easily in conversation

### Timeout Behavior

- `process_exec` default timeout: **30 seconds**, overridable per-call
- `process_start` has no timeout (it's intentionally long-running)
- When a timeout is reached, the process is killed and the tool returns the output collected so far plus a timeout error

### Environment Variables

**Inherit + extend**: Processes inherit the parent Node.js process's environment (PATH, HOME, etc.), plus agents can pass additional env vars per-call. This ensures system tools work out of the box while allowing customization.

### Working Directory

All commands run relative to the workspace root by default. Agents can specify a `cwd` parameter to run in a subdirectory (must be within the workspace boundary — same security check as file tools).

---

## 3. Architecture

### Module Structure

```
packages/core/src/
├── tools/
│   └── process-tools.ts          # 5 tool definitions (re-exports helpers)
├── process/
│   ├── ProcessRegistry.ts        # Registry + static singleton management
│   ├── OutputBuffer.ts           # Ring-buffer output capture
│   ├── process-helpers.ts        # resolveCwd, isBlocked, truncateOutput, config resolution
│   └── process-events.ts         # emitProcessEvent helper
├── events/
│   └── events.ts                 # Extended with process events (modify existing)
├── config/
│   └── ConfigSchema.ts           # Extended with process config (modify existing)
└── index.ts                      # Export new modules (modify existing)
```

### Data Flow

```
Agent uses process_exec tool
    │
    ▼
┌─────────────────────────────────────────────┐
│  process_exec tool                          │
│  1. Validate args (command, cwd, timeout)   │
│  2. Check blocklist                         │
│  3. Resolve shell from config               │
│  4. Spawn child process via node:child_process│
│  5. Capture stdout + stderr                 │
│  6. Wait for exit (or timeout)              │
│  7. Truncate output if needed               │
│  8. Emit process:completed event            │
│  9. Return ToolResult with output + exit code│
└─────────────────────────────────────────────┘

Agent uses process_start tool
    │
    ▼
┌─────────────────────────────────────────────┐
│  process_start tool                         │
│  1. Validate args                           │
│  2. Check concurrency limit                 │
│  3. Check blocklist                         │
│  4. Spawn child process (detached)          │
│  5. Register in ProcessRegistry             │
│  6. Set up output buffering                 │
│  7. Emit process:started event              │
│  8. Return ToolResult with process ID       │
│                                             │
│  (process runs in background)               │
│  - Output buffered in ProcessRegistry       │
│  - Exit/error events handled automatically  │
└─────────────────────────────────────────────┘

Agent uses process_status / process_stop
    │
    ▼
┌─────────────────────────────────────────────┐
│  ProcessRegistry                            │
│  - Map<processId, ProcessEntry>             │
│  - Stores: pid, command, status, output     │
│  - Handles cleanup on session end           │
└─────────────────────────────────────────────┘
```

---

## 4. Tool Specifications

### `process_exec` — Run a command synchronously

Execute a shell command, wait for it to complete, and return the output.

```typescript
const processExecTool: Tool = {
  name: 'process_exec',
  description:
    'Execute a shell command and wait for it to complete. Returns stdout, stderr, ' +
    'and exit code. Use this for short-lived commands (tests, builds, git, etc.). ' +
    'For long-running processes (servers, watchers), use process_start instead.',

  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute.',
      },
      cwd: {
        type: 'string',
        description:
          'Working directory relative to workspace root. Defaults to workspace root.',
      },
      timeout: {
        type: 'number',
        description:
          'Timeout in seconds. The process is killed if it exceeds this. ' +
          'Defaults to 30. Set to 0 for no timeout.',
      },
      env: {
        type: 'object',
        description:
          'Additional environment variables to set for this command. ' +
          'Merged with the inherited environment.',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['command'],
  },
};
```

**Return value** (on success):
```json
{
  "status": "success",
  "data": {
    "exitCode": 0,
    "stdout": "...",
    "stderr": "...",
    "durationMs": 1234,
    "truncated": false
  }
}
```

**Return value** (on timeout):
```json
{
  "status": "error",
  "error": "Process timed out after 30s. Partial output included.",
  "data": {
    "exitCode": null,
    "stdout": "... (partial)",
    "stderr": "... (partial)",
    "durationMs": 30000,
    "truncated": true,
    "timedOut": true
  }
}
```

**Return value** (non-zero exit):
```json
{
  "status": "success",
  "data": {
    "exitCode": 1,
    "stdout": "...",
    "stderr": "Error: test failed...",
    "durationMs": 4567,
    "truncated": false
  }
}
```

> **Note**: Non-zero exit codes return `status: 'success'` because the tool itself executed correctly — the *command* failed, not the *tool*. The agent receives the exit code and stderr and can interpret the failure. Tool `status: 'error'` is reserved for tool-level failures (invalid args, blocked command, spawn failure).

### `process_start` — Start a background process

Start a long-running process that runs in the background. Returns immediately with a process ID.

```typescript
const processStartTool: Tool = {
  name: 'process_start',
  description:
    'Start a long-running background process (e.g., dev server, file watcher). ' +
    'Returns a process ID that can be used with process_status and process_stop. ' +
    'The process runs until explicitly stopped or the session ends.',

  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to start.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory relative to workspace root.',
      },
      label: {
        type: 'string',
        description:
          'A human-readable label for this process (e.g., "dev-server", "test-watcher"). ' +
          'Helps identify the process later.',
      },
      env: {
        type: 'object',
        description: 'Additional environment variables.',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['command'],
  },
};
```

**Return value**:
```json
{
  "status": "success",
  "data": {
    "processId": 1,
    "pid": 12345,
    "label": "dev-server",
    "command": "npm run dev"
  }
}
```

### `process_status` — Check on a background process

Query the status and recent output of a background process.

```typescript
const processStatusTool: Tool = {
  name: 'process_status',
  description:
    'Check the status and recent output of a background process. ' +
    'Use the process ID returned by process_start.',

  parameters: {
    type: 'object',
    properties: {
      processId: {
        type: 'number',
        description: 'The process ID to check (from process_start).',
      },
      lines: {
        type: 'number',
        description:
          'Number of most recent output lines to return. Defaults to 50.',
      },
    },
    required: ['processId'],
  },
};
```

**Return value** (running):
```json
{
  "status": "success",
  "data": {
    "processId": 1,
    "state": "running",
    "pid": 12345,
    "label": "dev-server",
    "command": "npm run dev",
    "uptimeMs": 45000,
    "recentOutput": "Server listening on http://localhost:3000\n...",
    "totalOutputLines": 142,
    "totalOutputBytes": 8432
  }
}
```

**Return value** (exited):
```json
{
  "status": "success",
  "data": {
    "processId": 1,
    "state": "exited",
    "exitCode": 1,
    "label": "dev-server",
    "command": "npm run dev",
    "durationMs": 45000,
    "recentOutput": "... last 50 lines ...",
    "totalOutputLines": 142,
    "totalOutputBytes": 8432
  }
}
```

### `process_stop` — Terminate a background process

Stop a running background process. Sends SIGTERM, then SIGKILL after a grace period.

```typescript
const processStopTool: Tool = {
  name: 'process_stop',
  description:
    'Stop a running background process. Sends SIGTERM for a graceful shutdown, ' +
    'then SIGKILL after 5 seconds if the process has not exited.',

  parameters: {
    type: 'object',
    properties: {
      processId: {
        type: 'number',
        description: 'The process ID to stop.',
      },
    },
    required: ['processId'],
  },
};
```

**Return value**:
```json
{
  "status": "success",
  "data": {
    "processId": 1,
    "label": "dev-server",
    "exitCode": null,
    "signal": "SIGTERM",
    "finalOutput": "... last 20 lines ..."
  }
}
```

### `process_list` — List all tracked processes

List all background processes tracked in the current session.

```typescript
const processListTool: Tool = {
  name: 'process_list',
  description:
    'List all background processes in the current session, ' +
    'including running and recently exited processes.',

  parameters: {
    type: 'object',
    properties: {
      state: {
        type: 'string',
        enum: ['running', 'exited', 'all'],
        description: 'Filter by process state. Defaults to "all".',
      },
    },
  },
};
```

**Return value**:
```json
{
  "status": "success",
  "data": {
    "processes": [
      {
        "processId": 1,
        "state": "running",
        "pid": 12345,
        "label": "dev-server",
        "command": "npm run dev",
        "uptimeMs": 120000
      },
      {
        "processId": 2,
        "state": "exited",
        "exitCode": 0,
        "label": "build",
        "command": "npm run build",
        "durationMs": 8500
      }
    ],
    "running": 1,
    "total": 2,
    "limit": 10
  }
}
```

---

## 5. Process Registry

The `ProcessRegistry` is a session-scoped in-memory registry that tracks all background processes. It is **not** persisted to disk — processes are inherently ephemeral.

### Interface

```typescript
interface ProcessEntry {
  /** Incrementing ID within the session (1, 2, 3...) */
  processId: number;

  /** OS process ID */
  pid: number;

  /** The ChildProcess handle */
  handle: ChildProcess;

  /** The command that was run */
  command: string;

  /** Human-readable label */
  label?: string;

  /** Working directory */
  cwd: string;

  /** Current state */
  state: 'running' | 'exited';

  /** Exit code (null if still running or killed by signal) */
  exitCode: number | null;

  /** Signal that killed the process (SIGTERM, SIGKILL, etc.) */
  signal: string | null;

  /** Start time */
  startedAt: Date;

  /** End time (when the process exited) */
  endedAt?: Date;

  /** Captured output (combined stdout + stderr, line-buffered) */
  output: OutputBuffer;
}

class ProcessRegistry {
  /** Start tracking a new process */
  register(entry: Omit<ProcessEntry, 'processId'>): number;

  /** Get a process by ID */
  get(processId: number): ProcessEntry | undefined;

  /** List all processes, optionally filtered by state */
  list(state?: 'running' | 'exited' | 'all'): ProcessEntry[];

  /** Stop a process (SIGTERM → wait → SIGKILL) */
  stop(processId: number): Promise<ProcessEntry>;

  /** Kill all running processes (called on session end) */
  killAll(): Promise<void>;

  /** Current count of running processes */
  runningCount(): number;
}
```

### Output Buffering

Each background process stores its combined stdout/stderr in an `OutputBuffer`:

```typescript
class OutputBuffer {
  private lines: string[] = [];
  private totalBytes: number = 0;
  private readonly maxLines: number;  // Default: 10,000

  /** Append new output */
  append(chunk: string): void;

  /** Get the last N lines */
  tail(n: number): string;

  /** Get all output (may be large) */
  all(): string;

  /** Line count */
  lineCount(): number;

  /** Total bytes received */
  byteCount(): number;
}
```

The buffer uses a ring buffer strategy: when `maxLines` is exceeded, the oldest lines are dropped. This prevents unbounded memory growth from very chatty processes while keeping recent output accessible.

### Session Cleanup

When a session ends, the `ProcessRegistry.killAll()` method:

1. Sends SIGTERM to each running process
2. Waits up to 5 seconds for graceful shutdown
3. Sends SIGKILL to any process still running
4. Clears all entries

The REPL's session teardown code calls this during `/quit` or `Ctrl+C`.

---

## 6. Event System Extensions

Four new event types for process lifecycle visibility:

```typescript
export interface ProcessStartedEvent {
  type: 'process:started';
  sessionId: string;
  participantId: string;
  processId: number;
  pid: number;
  command: string;
  label?: string;
  timestamp: Date;
}

export interface ProcessOutputEvent {
  type: 'process:output';
  sessionId: string;
  processId: number;
  output: string;        // The new output chunk
  stream: 'stdout' | 'stderr';
  timestamp: Date;
}

export interface ProcessCompletedEvent {
  type: 'process:completed';
  sessionId: string;
  processId: number;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  timestamp: Date;
}

export interface ProcessErrorEvent {
  type: 'process:error';
  sessionId: string;
  processId: number;
  error: string;
  timestamp: Date;
}
```

These integrate into the existing `LegionEvent` union and `EventMap`.

The CLI's `display.ts` subscribes to these events to show:
- `process:started` → `🚀 Process #1 started: npm run dev (pid 12345)`
- `process:output` → Optionally streamable to terminal (controlled by verbosity)
- `process:completed` → `✓ Process #1 exited (code 0, 8.5s)` or `✗ Process #1 failed (code 1, 4.2s)`
- `process:error` → `⚠ Process #1 error: spawn ENOENT`

---

## 7. Configuration

### Config Schema Extensions

Add to `ProcessManagementConfig` in `ConfigSchema.ts`:

```typescript
const ProcessManagementSchema = z.object({
  /** Shell to use for command execution. Default: '/bin/sh' */
  shell: z.string().optional(),

  /** Default timeout for process_exec in seconds. Default: 30. 0 = no timeout. */
  defaultTimeout: z.number().min(0).optional(),

  /** Max output size in bytes before truncation. Default: 51200 (50KB) */
  maxOutputSize: z.number().min(1024).optional(),

  /** Max concurrent background processes. Default: 10. 0 = unlimited. */
  maxBackgroundProcesses: z.number().min(0).optional(),

  /** Max lines to buffer per background process. Default: 10000 */
  maxOutputLines: z.number().min(100).optional(),

  /** Command blocklist — patterns that are always rejected */
  blocklist: z.array(z.string()).optional(),
});
```

### Default Configuration

```json
{
  "processManagement": {
    "shell": "/bin/sh",
    "defaultTimeout": 30,
    "maxOutputSize": 51200,
    "maxBackgroundProcesses": 10,
    "maxOutputLines": 10000,
    "blocklist": [
      "rm -rf /",
      "rm -rf /*",
      "mkfs",
      "dd if=",
      ":(){:|:&};:",
      "shutdown",
      "reboot",
      "halt",
      "poweroff",
      "init 0",
      "init 6"
    ]
  }
}
```

### Resolution Order

Same as all other config:
1. Workspace config (`.legion/config.json` → `processManagement`)
2. Global config (`~/.config/legion/config.json` → `defaults.processManagement`)
3. Built-in defaults (above)

---

## 8. Authorization & Safety

### Default Tool Policies

Added to `DEFAULT_TOOL_POLICIES`:

```typescript
// Process tools — require approval by default
process_exec: 'requires_approval',
process_start: 'requires_approval',
process_stop: 'auto',          // Stopping is generally safe
process_status: 'auto',        // Read-only query
process_list: 'auto',          // Read-only query
```

> `process_exec` and `process_start` default to `requires_approval` because commands can have significant side effects. Agents or workspaces can override to `auto` for trusted contexts (e.g., `"process_exec": { "mode": "auto" }` in the participant's tool policies).

### Command Blocklist

Before executing any command (`process_exec` or `process_start`), the tool checks the command string against the configured blocklist. This is a substring match — if any blocklist entry appears anywhere in the command, the tool returns an error:

```typescript
function isBlocked(command: string, blocklist: string[]): string | null {
  const normalized = command.trim().toLowerCase();
  for (const pattern of blocklist) {
    if (normalized.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}
```

This is intentionally simple substring matching. It's a safety net, not a security boundary — the authorization system (auto vs requires_approval) is the primary control. The blocklist catches obviously destructive commands even in `auto` mode.

> **Phase 3 upgrade path**: When granular scoped authorization is implemented, the blocklist can be replaced with properly scoped policies (e.g., allow `npm test` auto, require approval for `rm`, deny `shutdown`). The blocklist is a bridge until then.

### Workspace Boundary

The `cwd` parameter is validated the same way file tools validate paths: the resolved path must be within the workspace root. Attempting to run commands in `/etc/` or `../../other-project/` is rejected.

---

## 9. CLI Integration

### Display Events

Update `display.ts` to subscribe to the 4 new process events with appropriate formatting:

```typescript
eventBus.on('process:started', (e) => {
  const label = e.label ? ` (${e.label})` : '';
  console.log(chalk.cyan(`  🚀 Process #${e.processId} started: ${e.command}${label}`));
});

eventBus.on('process:completed', (e) => {
  const icon = e.exitCode === 0 ? '✓' : '✗';
  const color = e.exitCode === 0 ? chalk.green : chalk.red;
  const duration = (e.durationMs / 1000).toFixed(1);
  console.log(color(`  ${icon} Process #${e.processId} exited (code ${e.exitCode}, ${duration}s)`));
});

eventBus.on('process:error', (e) => {
  console.log(chalk.red(`  ⚠ Process #${e.processId} error: ${e.error}`));
});
```

`process:output` events are **not** displayed by default to avoid flooding the terminal. They could be enabled via a verbosity flag or a future `/process watch <id>` command.

### Session Teardown

When the REPL exits (`/quit`, `Ctrl+C`, or session end), ensure `ProcessRegistry.killAll()` is called to clean up background processes. This should be wired into the existing REPL cleanup flow.

### Future REPL Commands (not Phase 2 scope, but designed for)

These would be natural additions to the REPL later:

- `/ps` — list running background processes
- `/kill <id>` — stop a background process
- `/logs <id>` — show recent output of a background process

---

## 10. Implementation Milestones

### Milestone 2.1: ProcessRegistry & Output Buffering ✅
**Files**: `packages/core/src/process/OutputBuffer.ts`, `packages/core/src/process/ProcessRegistry.ts`
**Exported from**: `packages/core/src/index.ts`

- [x] `OutputBuffer` class with ring buffer strategy, `append()`, `tail()`, `flush()`, `lineCount()`, `byteCount()`, `totalLineCount()`, `hasDroppedLines()`, `droppedLineCount()`
- [x] `ProcessEntry` interface with `useProcessGroup` flag (controls whether `process.kill(-pid)` is used vs `handle.kill()`)
- [x] `ProcessRegistry` class with `register()`, `get()`, `list()`, `stop()`, `killAll()`, `runningCount()`, `totalCount()`, `clear()`
- [x] Session-scoped process ID generation (incrementing integers)
- [x] Graceful shutdown: SIGTERM → configurable grace period → SIGKILL (via `sendSignal()` helper)
- [x] Unit tests for `OutputBuffer` — **28 tests** (append, partial lines, flush, truncation, ring buffer, tail, byte counting, edge cases)
- [x] Unit tests for `ProcessRegistry` — **27 tests** (register, stdout/stderr capture, close/error handling, concurrency limit, get, list filtering, counts, stop, killAll, clear)

**Implementation notes**:
- Process group kills (`process.kill(-pid)`) are gated behind `useProcessGroup: boolean` on `ProcessEntry` (default: `false`). Only `process_start` (Milestone 2.2) will set this to `true` when spawning detached processes. This prevents tests from sending real signals to system process groups.
- `OutputBuffer` handles partial lines across chunks (buffered until newline), multi-byte UTF-8, and ring buffer eviction with accurate total-line tracking.

### Milestone 2.2: Core Process Execution ✅
**Files**: `packages/core/src/tools/process-tools.ts`, `packages/core/src/tools/process-tools.test.ts`
**Exported from**: `packages/core/src/index.ts`

- [x] Helper: `resolveCwd()` — validate cwd within workspace boundary
- [x] Helper: `isBlocked()` — check command against blocklist (case-insensitive substring)
- [x] Helper: `resolveShell()` — resolve shell from config (defaults to `/bin/sh`, config wiring in 2.4)
- [x] Helper: `truncateOutput()` — head/tail truncation strategy (~40%/40% split with `[... N bytes truncated ...]` marker)
- [x] Helper: `resolveBlocklist()`, `resolveDefaultTimeout()`, `resolveMaxOutputBytes()` — config resolution stubs (fall back to defaults; wired in 2.4)
- [x] `process_exec` tool — full implementation
  - [x] Spawn via `child_process.spawn` with shell mode
  - [x] Capture stdout + stderr separately, return both in result
  - [x] Timeout handling (SIGTERM → 2s → SIGKILL, returns partial output with `timedOut: true`)
  - [x] Output truncation (50KB default limit per stream)
  - [x] Register in ProcessRegistry as `mode: 'sync'` for unified visibility
  - [x] Emit `process:completed` event (deferred to Milestone 2.4 — event types not yet defined)
- [x] `process_start` tool — full implementation
  - [x] Spawn via `child_process.spawn` with `detached: true`, shell mode
  - [x] Register in ProcessRegistry as `mode: 'background'` with `useProcessGroup: true`
  - [x] `child.unref()` so background process doesn't keep Node alive
  - [x] Output buffered via ProcessRegistry's automatic stdout/stderr capture
  - [x] Emit `process:started` event (deferred to Milestone 2.4)
- [x] `ProcessEntry` extended with `mode: 'sync' | 'background'` field (design decision: unified registry)
- [x] Module-scoped ProcessRegistry with `setProcessRegistry()` / `getProcessRegistry()` (session lifecycle wiring in 2.5)
- [x] Unit tests — **40 tests** with mocked `child_process.spawn`
  - `resolveCwd`: 5 tests (relative, absolute, boundary, escape)
  - `isBlocked`: 5 tests (safe commands, blocked, case-insensitive, substring, empty list)
  - `truncateOutput`: 4 tests (under limit, over limit, head/tail preservation, exact limit)
  - `process_exec`: 16 tests (validation, blocklist, cwd, shell args, env, stdout/stderr, exit codes, registry mode, spawn errors, timeout, truncation, processId)
  - `process_start`: 10 tests (validation, blocklist, cwd, detached, unref, registry mode, env, label, concurrency limit)

**Implementation notes**:
- Used `spawn()` (not `execFile()`) for `process_exec` because both tools benefit from the same shell-based execution model and the `spawn` API gives us streaming stdout/stderr handles for registry capture.
- `process_exec` registers in ProcessRegistry as `mode: 'sync'` — implements the "Unified Process Registry" design decision so all processes are visible and counted toward the concurrency limit.
- Event emission deferred to Milestone 2.4 when event types are defined. The tools have TODO markers where events will be emitted.
- Config resolution helpers are stubbed — they return built-in defaults. Milestone 2.4 will wire them to the actual config system.

### Milestone 2.3: Process Query & Control Tools ✅
**Files**: `packages/core/src/tools/process-tools.ts`, `packages/core/src/tools/process-tools.test.ts`
**Exported from**: `packages/core/src/index.ts`

- [x] `process_status` tool — query ProcessRegistry, return state, recent output, uptime/duration, mode, cwd, output stats
- [x] `process_stop` tool — delegates to `ProcessRegistry.stop()`, returns `alreadyExited: true` if process has already exited
- [x] `process_list` tool — delegates to `ProcessRegistry.list()`, supports filtering by both `state` and `mode`
- [x] All three tools include `mode` field in responses (sync/background)
- [x] Unit tests — **22 tests**
  - `process_status`: 6 tests (validation, not found, running status, exited status, lines parameter, null label, cwd)
  - `process_stop`: 4 tests (validation, not found, already exited, stop running process)
  - `process_list`: 12 tests (empty list, list all, filter by state running/exited, filter by mode sync/background, combined filters, uptimeMs vs durationMs, concurrency limit in response)

**Implementation notes**:
- `process_status` returns `uptimeMs` for running processes and `durationMs` for exited processes, matching the spec.
- `process_list` adds a `mode` filter parameter (not in original spec) to let agents filter sync vs background processes — natural extension of the unified registry design.
- `process_stop` returns `alreadyExited: true` when the process has already exited, avoiding unnecessary error responses for a benign condition.
- The concurrency `limit` in `process_list` response is hardcoded to 10 — will be read from config in Milestone 2.4.

### Milestone 2.4: Configuration & Event Extensions ✅
**Files**: `packages/core/src/config/ConfigSchema.ts`, `packages/core/src/events/events.ts`, `packages/core/src/authorization/policies.ts`, `packages/core/src/tools/process-tools.ts`

- [x] Add `ProcessManagementSchema` to `ConfigSchema.ts`
  - Fields: `shell`, `defaultTimeout`, `maxOutputSize`, `maxConcurrentProcesses`, `maxOutputLines`, `blocklist` — all optional with Zod defaults
- [x] Add process management config to `WorkspaceConfigSchema` (as optional `processManagement` field)
- [x] Add 4 new event types to `events.ts` (ProcessStartedEvent, ProcessOutputEvent, ProcessCompletedEvent, ProcessErrorEvent)
  - ProcessStartedEvent & ProcessCompletedEvent include `mode: 'sync' | 'background'`
  - ProcessOutputEvent includes `stream: 'stdout' | 'stderr'`
- [x] Extend `LegionEvent` union and `EventMap` with all 4 new event types
- [x] Add default policies for process tools to `DEFAULT_TOOL_POLICIES`
  - `process_exec`, `process_start`: `requires_approval`
  - `process_stop`, `process_status`, `process_list`: `auto`
- [x] Config resolution for process management settings in process tools
  - `getProcessConfig()` reads from `context.config.get('processManagement')` with try/catch for test safety
  - `resolveShell`, `resolveBlocklist`, `resolveDefaultTimeout`, `resolveMaxOutputBytes` all wired to config
- [x] Event emission in `process_exec` (started, completed, error) and `process_start` (started)
  - `emitProcessEvent()` helper with typed overloads, silently catches errors
- [x] Export new types from `packages/core/src/index.ts` (`ProcessManagementSchema`, `ProcessManagementConfig`, 4 event types)

**Implementation notes:**
- Config resolution uses try/catch so tests with minimal `RuntimeContext` stubs don't crash.
- Event emission is fire-and-forget — errors in `emitProcessEvent()` are silently caught to never break tool execution.
- All 178 tests passing, build clean.

### Milestone 2.5: Registration & CLI Integration ✅
**Files**: `packages/core/src/workspace/Workspace.ts`, `packages/core/src/index.ts`, `packages/cli/src/repl/display.ts`, `packages/cli/src/repl/REPL.ts`

- [x] Register process tools in `Workspace.registerBuiltinTools()`
  - Added `processTools` array to the built-in tool list alongside existing tool groups
- [x] Export process tools from `packages/core/src/index.ts` (already done in milestone 2.3)
- [x] Wire `ProcessRegistry` into the session lifecycle
  - [x] Create registry when session starts (`new ProcessRegistry()` in REPL.start())
  - [x] Set as module singleton via `setProcessRegistry()` so all process tools share it
  - [x] Call `killAll()` on session end / REPL exit (both `/quit` command and `Ctrl+C` / readline close)
- [x] Added `cleanup()` method to REPL that kills all background processes with user-visible message
- [x] Add process event handlers to `display.ts`
  - `process:started` → 🚀 with process ID, command, and optional label
  - `process:completed` → ✓/✗ with exit code and duration
  - `process:error` → ⚠ with error message
- [x] Fixed `process_list` concurrency limit to read from config (`maxConcurrentProcesses`) instead of hardcoded 10
- [x] All 178 tests passing, build clean

**Implementation notes:**
- ProcessRegistry lifecycle: created in `REPL.start()`, stored as instance field, set as module singleton. On exit, `cleanup()` calls `killAll()` which sends SIGTERM → grace period → SIGKILL.
- The `close` event handler on readline is now `async` to support the async `killAll()` call.
- `process:output` events are NOT displayed — they would flood the terminal. Can be enabled later via a verbosity flag or `/process watch <id>` command.

### Milestone 2.6: Integration Tests
- [ ] End-to-end test: `process_exec` runs a command and returns output
- [ ] Test: `process_exec` with timeout kills the process
- [ ] Test: `process_exec` with large output truncates correctly
- [ ] Test: `process_start` + `process_status` + `process_stop` lifecycle
- [ ] Test: Concurrency limit enforcement
- [ ] Test: Blocklist rejection
- [ ] Test: `cwd` workspace boundary enforcement
- [ ] Test: Session cleanup kills all background processes
- [ ] Test: Non-zero exit code returns `status: 'success'` with exit code

---

## 11. Testing Strategy

### What to Mock

- **`child_process.spawn` / `child_process.execFile`**: Mock in unit tests. Create a `MockChildProcess` that emits `data`, `close`, and `error` events on demand.
- **Config**: Use in-memory config with known values (shell, timeout, blocklist, limits).
- **EventBus**: Real `EventBus` — verify events are emitted with correct payloads.

### What NOT to Mock

- **OutputBuffer**: Test with real data — append, truncation, ring buffer behavior.
- **ProcessRegistry**: Test with mock ProcessEntries — registration, listing, limit enforcement, cleanup.
- **Blocklist checking**: Test with real string matching.
- **Output truncation**: Test with real strings of various sizes.

### Integration Tests

For integration tests that actually spawn processes, use safe, fast, portable commands:

```typescript
// Good test commands (cross-platform, fast, deterministic)
'echo hello world'          // Basic output
'echo error >&2'            // stderr output
'exit 1'                    // Non-zero exit
'sleep 1'                   // For timeout testing
'cat'                       // For stdin/hang testing (with timeout)
'seq 1 10000'               // Large output generation
'pwd'                       // Working directory verification
```

Use temp directories for any test that involves cwd validation.

---

## 12. Open Questions

1. **stdin support** — Should `process_exec` support writing to stdin? Use case: piping data to commands like `wc`, `sort`, or custom scripts. Recommend: defer to a future enhancement. Most agent use cases don't need stdin.

2. **Signal choice** — Should `process_stop` accept a custom signal (SIGTERM, SIGINT, SIGKILL, SIGHUP)? Or always use SIGTERM → SIGKILL? Recommend: default SIGTERM → SIGKILL, add signal parameter later if needed.

3. **Output separation** — Should `process_exec` return stdout and stderr separately, or combined? The current spec returns both separately. Combined is simpler for agents but loses the distinction. Recommend: return both, with a combined `output` field for convenience.

4. **Process groups** — Should `process_start` use process groups (`detached: true` + `process.kill(-pid)`) to ensure all child processes are killed? Important for commands like `npm run dev` that spawn sub-processes. Recommend: yes, use process groups from the start.

5. **Interactivity** — Some commands prompt for input (e.g., `npm init`, `git commit` without `-m`). These will hang until timeout. Should we document this? Recommend: yes, add a note in the tool description advising agents to use non-interactive flags.

6. **Sync process registration** — Should `process_exec` (synchronous) commands also be registered in the ProcessRegistry? See **Design Decision: Unified Process Registry** below.

### Design Decision: Unified Process Registry

**Decision**: Yes — `process_exec` should register processes in the ProcessRegistry too.

**Rationale**:
- **Visibility**: Multiple conversations/agents can run processes in parallel. Without registry tracking, there's no way for one agent to know another is already running `npm test` or `npm run build`.
- **Single cleanup path**: On session teardown, `killAll()` should handle everything. If sync processes aren't registered, we need a separate mechanism to track and kill in-flight `process_exec` calls — two code paths doing the same thing.
- **Deduplication/awareness**: Agents can check `process_list` before starting a command to avoid redundant work or conflicting operations.
- **Consistent concurrency accounting**: The concurrency limit should count all running processes, not just background ones.

**Implementation**:
- Add a `mode: 'sync' | 'background'` field to `ProcessEntry`
- `process_exec` registers the process as `mode: 'sync'`, runs it, waits for exit, then leaves the exited entry in the registry (for visibility)
- `process_start` registers as `mode: 'background'`
- `process_list` can filter by mode
- The concurrency limit counts both modes
- `killAll()` kills both modes (important for long-running sync commands still in-flight during session teardown)

---

## Estimated Effort

| Milestone | Effort |
|---|---|
| 2.1 ProcessRegistry & OutputBuffer | 1 day |
| 2.2 Core process tools (exec + start) | 1–2 days |
| 2.3 Query & control tools | 0.5 days |
| 2.4 Config & event extensions | 0.5 days |
| 2.5 Registration & CLI integration | 0.5 days |
| 2.6 Integration tests | 1 day |
| **Total** | **~4–5 days** |

---

## Post-Phase 2: Refactoring Notes

### `process-tools.ts` decomposition ✅

The `process-tools.ts` file had grown to ~900 lines with too many concerns. Refactored into focused modules:

| Module | Location | Lines | Responsibility |
|---|---|---|---|
| `process-tools.ts` | `tools/` | ~655 | 5 tool definitions + `processTools` array |
| `process-helpers.ts` | `process/` | ~182 | `resolveCwd`, `isBlocked`, `truncateOutput`, config resolution, default constants |
| `process-events.ts` | `process/` | ~79 | `emitProcessEvent` with typed overloads |
| `ProcessRegistry.ts` | `process/` | +40 | Static singleton: `getInstance()`, `setInstance()`, `getInstanceOrUndefined()`, `clearInstance()` |

**What changed:**
1. Extracted all pure helpers and config resolution into `process/process-helpers.ts`
2. Extracted event emission into `process/process-events.ts`
3. Moved registry singleton management to `ProcessRegistry` static methods (`getInstance()` / `setInstance()`)
4. `process-tools.ts` re-exports helpers for backwards compatibility — no import changes needed for existing consumers
5. `setProcessRegistry()` / `getProcessRegistry()` kept as deprecated wrappers delegating to `ProcessRegistry.setInstance()` / `ProcessRegistry.getInstanceOrUndefined()`
6. REPL updated to use `ProcessRegistry.setInstance()` directly
7. Helper files live in `process/` directory (not `tools/`) to keep `tools/` focused on tool definitions
