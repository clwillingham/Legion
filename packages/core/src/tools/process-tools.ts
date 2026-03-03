/**
 * Process management tools — process_exec, process_start, process_status,
 * process_stop, and process_list.
 *
 * Tool definitions only. Helpers, config resolution, and event emission
 * are factored into process-helpers.ts and process-events.ts.
 */

import { spawn } from 'node:child_process';
import type { Tool, ToolResult, JSONSchema } from './Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';
import { ProcessRegistry } from '../process/ProcessRegistry.js';
import {
  resolveCwd,
  isBlocked,
  truncateOutput,
  resolveShell,
  resolveBlocklist,
  resolveDefaultTimeout,
  resolveMaxOutputBytes,
  getProcessConfig,
} from '../process/process-helpers.js';
import { emitProcessEvent } from '../process/process-events.js';

// Re-export helpers for backwards compatibility with existing imports
export {
  resolveCwd,
  isBlocked,
  truncateOutput,
  resolveShell,
  resolveBlocklist,
  resolveDefaultTimeout,
  resolveMaxOutputBytes,
  getProcessConfig,
} from '../process/process-helpers.js';
export { emitProcessEvent } from '../process/process-events.js';

/**
 * @deprecated Use `ProcessRegistry.setInstance()` instead.
 */
export function setProcessRegistry(registry: ProcessRegistry): void {
  ProcessRegistry.setInstance(registry);
}

/**
 * @deprecated Use `ProcessRegistry.getInstanceOrUndefined()` instead.
 */
export function getProcessRegistry(): ProcessRegistry | undefined {
  return ProcessRegistry.getInstanceOrUndefined();
}

// ── process_exec ───────────────────────────────────────────────

export const processExecTool: Tool = {
  name: 'process_exec',
  description:
    'Execute a shell command and wait for it to complete. Returns stdout, stderr, ' +
    'and exit code. Use this for short-lived commands (tests, builds, git, etc.). ' +
    'For long-running processes (servers, watchers), use process_start instead. ' +
    'Avoid interactive commands that prompt for input — use non-interactive flags.',

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
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const {
      command,
      cwd: cwdArg,
      timeout: timeoutArg,
      env: envArg,
    } = args as {
      command: string;
      cwd?: string;
      timeout?: number;
      env?: Record<string, string>;
    };

    if (!command || typeof command !== 'string' || !command.trim()) {
      return { status: 'error', error: 'command is required and must be a non-empty string.' };
    }

    // Resolve configuration
    const shell = resolveShell(context);
    const blocklist = resolveBlocklist(context);
    const defaultTimeout = resolveDefaultTimeout(context);
    const maxOutputBytes = resolveMaxOutputBytes(context);

    // Check blocklist
    const blockedBy = isBlocked(command, blocklist);
    if (blockedBy) {
      return {
        status: 'error',
        error: `Command blocked: matches blocklist pattern '${blockedBy}'.`,
      };
    }

    // Resolve working directory
    const workspaceRoot = process.cwd(); // Will use context.workspace.root later
    const resolvedCwd = resolveCwd(cwdArg, workspaceRoot);
    if (typeof resolvedCwd !== 'string') return resolvedCwd; // ToolResult error

    // Resolve timeout
    const timeoutSec = timeoutArg ?? defaultTimeout;
    const timeoutMs = timeoutSec > 0 ? timeoutSec * 1_000 : 0;

    // Build environment
    const env = envArg ? { ...process.env, ...envArg } : process.env;

    const startTime = Date.now();
    const registry = ProcessRegistry.getInstance();

    return new Promise<ToolResult>((resolve) => {
      // Spawn the child process via shell
      const child = spawn(command, [], {
        shell,
        cwd: resolvedCwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Register in the ProcessRegistry for visibility
      const processId = registry.register({
        handle: child,
        command,
        cwd: resolvedCwd,
        label: undefined,
        useProcessGroup: false,
        mode: 'sync',
      });

      // Emit process:started event
      emitProcessEvent(context, 'process:started', {
        processId,
        pid: child.pid ?? -1,
        command,
        mode: 'sync' as const,
      });

      let timedOut = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

      // Set up timeout
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          try {
            child.kill('SIGTERM');
          } catch {
            // Process may have already exited
          }

          // If SIGTERM doesn't work, SIGKILL after 2s
          setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // Already dead
            }
          }, 2_000);
        }, timeoutMs);
      }

      // Collect stdout and stderr separately for the return value
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('close', (code: number | null, signal: string | null) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const durationMs = Date.now() - startTime;

        // Emit process:completed event
        emitProcessEvent(context, 'process:completed', {
          processId,
          command,
          exitCode: code,
          signal,
          durationMs,
          mode: 'sync' as const,
        });

        // Truncate output if needed
        const stdoutResult = truncateOutput(stdout, maxOutputBytes);
        const stderrResult = truncateOutput(stderr, maxOutputBytes);
        const truncated = stdoutResult.truncated || stderrResult.truncated;

        if (timedOut) {
          resolve({
            status: 'error',
            error: `Process timed out after ${timeoutSec}s. Partial output included.`,
            data: {
              processId,
              exitCode: code,
              signal: signal ?? 'SIGTERM',
              stdout: stdoutResult.text,
              stderr: stderrResult.text,
              durationMs,
              truncated,
              timedOut: true,
            },
          });
        } else {
          resolve({
            status: 'success',
            data: {
              processId,
              exitCode: code ?? 0,
              stdout: stdoutResult.text,
              stderr: stderrResult.text,
              durationMs,
              truncated,
            },
          });
        }
      });

      child.on('error', (err: Error) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const durationMs = Date.now() - startTime;

        // Emit process:error event
        emitProcessEvent(context, 'process:error', {
          processId,
          error: err.message,
        });

        resolve({
          status: 'error',
          error: `Failed to execute command: ${err.message}`,
          data: {
            processId,
            exitCode: null,
            stdout,
            stderr,
            durationMs,
            truncated: false,
          },
        });
      });
    });
  },
};

// ── process_start ──────────────────────────────────────────────

export const processStartTool: Tool = {
  name: 'process_start',
  description:
    'Start a long-running background process (e.g., dev server, file watcher). ' +
    'Returns a process ID that can be used with process_status and process_stop. ' +
    'The process runs until explicitly stopped or the session ends. ' +
    'Avoid interactive commands that prompt for input.',

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
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const {
      command,
      cwd: cwdArg,
      label,
      env: envArg,
    } = args as {
      command: string;
      cwd?: string;
      label?: string;
      env?: Record<string, string>;
    };

    if (!command || typeof command !== 'string' || !command.trim()) {
      return { status: 'error', error: 'command is required and must be a non-empty string.' };
    }

    // Resolve configuration
    const shell = resolveShell(context);
    const blocklist = resolveBlocklist(context);

    // Check blocklist
    const blockedBy = isBlocked(command, blocklist);
    if (blockedBy) {
      return {
        status: 'error',
        error: `Command blocked: matches blocklist pattern '${blockedBy}'.`,
      };
    }

    // Resolve working directory
    const workspaceRoot = process.cwd(); // Will use context.workspace.root later
    const resolvedCwd = resolveCwd(cwdArg, workspaceRoot);
    if (typeof resolvedCwd !== 'string') return resolvedCwd; // ToolResult error

    // Build environment
    const env = envArg ? { ...process.env, ...envArg } : process.env;

    const registry = ProcessRegistry.getInstance();

    try {
      // Spawn detached so the process and its children form a process group
      const child = spawn(command, [], {
        shell,
        cwd: resolvedCwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      // Don't let the child keep our process alive
      child.unref();

      // Register in the ProcessRegistry
      const processId = registry.register({
        handle: child,
        command,
        cwd: resolvedCwd,
        label,
        useProcessGroup: true,
        mode: 'background',
      });

      const entry = registry.get(processId)!;

      // Emit process:started event
      emitProcessEvent(context, 'process:started', {
        processId,
        pid: entry.pid,
        command,
        label,
        mode: 'background' as const,
      });

      return {
        status: 'success',
        data: {
          processId,
          pid: entry.pid,
          label: label ?? null,
          command,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        error: `Failed to start process: ${errorMessage}`,
      };
    }
  },
};

// ── process_status ─────────────────────────────────────────────

export const processStatusTool: Tool = {
  name: 'process_status',
  description:
    'Check the status and recent output of a tracked process. ' +
    'Use the process ID returned by process_start or process_exec.',

  parameters: {
    type: 'object',
    properties: {
      processId: {
        type: 'number',
        description: 'The process ID to check.',
      },
      lines: {
        type: 'number',
        description:
          'Number of most recent output lines to return. Defaults to 50.',
      },
    },
    required: ['processId'],
  } as JSONSchema,

  async execute(args: unknown, _context: RuntimeContext): Promise<ToolResult> {
    const { processId, lines = 50 } = args as {
      processId: number;
      lines?: number;
    };

    if (processId === undefined || processId === null || typeof processId !== 'number') {
      return { status: 'error', error: 'processId is required and must be a number.' };
    }

    const registry = ProcessRegistry.getInstance();
    const entry = registry.get(processId);

    if (!entry) {
      return { status: 'error', error: `Process #${processId} not found.` };
    }

    const now = Date.now();
    const recentOutput = entry.output.tail(lines);

    if (entry.state === 'running') {
      return {
        status: 'success',
        data: {
          processId: entry.processId,
          state: 'running',
          mode: entry.mode,
          pid: entry.pid,
          label: entry.label ?? null,
          command: entry.command,
          cwd: entry.cwd,
          uptimeMs: now - entry.startedAt.getTime(),
          recentOutput,
          totalOutputLines: entry.output.totalLineCount(),
          totalOutputBytes: entry.output.byteCount(),
        },
      };
    }

    // state === 'exited'
    const durationMs = entry.endedAt
      ? entry.endedAt.getTime() - entry.startedAt.getTime()
      : now - entry.startedAt.getTime();

    return {
      status: 'success',
      data: {
        processId: entry.processId,
        state: 'exited',
        mode: entry.mode,
        exitCode: entry.exitCode,
        signal: entry.signal,
        label: entry.label ?? null,
        command: entry.command,
        cwd: entry.cwd,
        durationMs,
        recentOutput,
        totalOutputLines: entry.output.totalLineCount(),
        totalOutputBytes: entry.output.byteCount(),
      },
    };
  },
};

// ── process_stop ───────────────────────────────────────────────

export const processStopTool: Tool = {
  name: 'process_stop',
  description:
    'Stop a running process. Sends SIGTERM for a graceful shutdown, ' +
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
  } as JSONSchema,

  async execute(args: unknown, _context: RuntimeContext): Promise<ToolResult> {
    const { processId } = args as { processId: number };

    if (processId === undefined || processId === null || typeof processId !== 'number') {
      return { status: 'error', error: 'processId is required and must be a number.' };
    }

    const registry = ProcessRegistry.getInstance();
    const entry = registry.get(processId);

    if (!entry) {
      return { status: 'error', error: `Process #${processId} not found.` };
    }

    if (entry.state === 'exited') {
      return {
        status: 'success',
        data: {
          processId: entry.processId,
          label: entry.label ?? null,
          exitCode: entry.exitCode,
          signal: entry.signal,
          alreadyExited: true,
          finalOutput: entry.output.tail(20),
        },
      };
    }

    try {
      const stopped = await registry.stop(processId);

      return {
        status: 'success',
        data: {
          processId: stopped.processId,
          label: stopped.label ?? null,
          exitCode: stopped.exitCode,
          signal: stopped.signal,
          finalOutput: stopped.output.tail(20),
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        error: `Failed to stop process #${processId}: ${errorMessage}`,
      };
    }
  },
};

// ── process_list ───────────────────────────────────────────────

export const processListTool: Tool = {
  name: 'process_list',
  description:
    'List all tracked processes in the current session, ' +
    'including running and recently exited processes.',

  parameters: {
    type: 'object',
    properties: {
      state: {
        type: 'string',
        enum: ['running', 'exited', 'all'],
        description: 'Filter by process state. Defaults to "all".',
      },
      mode: {
        type: 'string',
        enum: ['sync', 'background', 'all'],
        description: 'Filter by execution mode. Defaults to "all".',
      },
    },
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const { state = 'all', mode = 'all' } = args as {
      state?: 'running' | 'exited' | 'all';
      mode?: 'sync' | 'background' | 'all';
    };

    const registry = ProcessRegistry.getInstance();
    let entries = registry.list(state === 'all' ? 'all' : state);

    // Apply mode filter if specified
    if (mode !== 'all') {
      entries = entries.filter((e) => e.mode === mode);
    }

    const now = Date.now();

    const processes = entries.map((entry) => {
      const base = {
        processId: entry.processId,
        state: entry.state,
        mode: entry.mode,
        pid: entry.pid,
        label: entry.label ?? null,
        command: entry.command,
      };

      if (entry.state === 'running') {
        return {
          ...base,
          uptimeMs: now - entry.startedAt.getTime(),
        };
      }

      // exited
      const durationMs = entry.endedAt
        ? entry.endedAt.getTime() - entry.startedAt.getTime()
        : now - entry.startedAt.getTime();

      return {
        ...base,
        exitCode: entry.exitCode,
        signal: entry.signal,
        durationMs,
      };
    });

    return {
      status: 'success',
      data: {
        processes,
        running: registry.runningCount(),
        total: registry.totalCount(),
        limit: getProcessConfig(context)?.maxConcurrentProcesses ?? 10,
      },
    };
  },
};

// ── Exports ────────────────────────────────────────────────────

/** All process tools for convenient registration */
export const processTools: Tool[] = [
  processExecTool,
  processStartTool,
  processStatusTool,
  processStopTool,
  processListTool,
];
