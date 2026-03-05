/**
 * ProcessRegistry — session-scoped registry for background processes.
 *
 * Tracks all background processes started during a session, provides
 * query/control operations, and handles cleanup (kill all) on session end.
 *
 * Not persisted to disk — processes are inherently ephemeral.
 */

import type { ChildProcess } from 'node:child_process';
import { OutputBuffer } from './OutputBuffer.js';

// ── Types ───────────────────────────────────────────────────────

/**
 * State of a tracked process.
 */
export type ProcessState = 'running' | 'exited';

/**
 * Process execution mode.
 * - 'sync': started by process_exec, tool awaits completion
 * - 'background': started by process_start, runs detached
 */
export type ProcessMode = 'sync' | 'background';

/**
 * A tracked process entry.
 */
export interface ProcessEntry {
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
  state: ProcessState;

  /** Exit code (null if still running or killed by signal) */
  exitCode: number | null;

  /** Signal that killed the process (SIGTERM, SIGKILL, etc.) */
  signal: string | null;

  /** Start time */
  startedAt: Date;

  /** End time (when the process exited) */
  endedAt?: Date;

  /** Captured output (combined stdout + stderr) */
  output: OutputBuffer;

  /** Whether this process was spawned detached (use process group kills) */
  useProcessGroup: boolean;

  /** Execution mode: sync (process_exec) or background (process_start) */
  mode: ProcessMode;
}

/**
 * Callback invoked when a process produces output.
 * Receives the raw chunk and the stream it came from.
 */
export type ProcessOutputCallback = (
  processId: number,
  chunk: string,
  stream: 'stdout' | 'stderr',
) => void;

/**
 * Options for registering a new process.
 */
export interface RegisterProcessOptions {
  /** The ChildProcess handle */
  handle: ChildProcess;

  /** The command that was run */
  command: string;

  /** Working directory */
  cwd: string;

  /** Human-readable label */
  label?: string;

  /** Whether this process was spawned detached (use process group kills) */
  useProcessGroup?: boolean;

  /** Execution mode: sync (process_exec) or background (process_start). Defaults to 'background'. */
  mode?: ProcessMode;

  /** Optional callback invoked when the process produces output. */
  onOutput?: ProcessOutputCallback;
}

// ── Constants ───────────────────────────────────────────────────

/** Default grace period before SIGKILL (ms) */
const KILL_GRACE_MS = 5_000;

// ── ProcessRegistry ─────────────────────────────────────────────

export class ProcessRegistry {
  private processes = new Map<number, ProcessEntry>();
  private nextId = 1;
  private maxProcesses: number;
  private maxOutputLines: number;

  /**
   * @param maxProcesses - Max concurrent background processes. 0 = unlimited.
   * @param maxOutputLines - Max output lines buffered per process.
   */
  constructor(maxProcesses = 10, maxOutputLines = 10_000) {
    this.maxProcesses = maxProcesses;
    this.maxOutputLines = maxOutputLines;
  }

  /**
   * Register a new background process.
   *
   * Sets up stdout/stderr capture and exit handling automatically.
   * Returns the assigned process ID.
   *
   * @throws Error if the concurrency limit is reached.
   */
  register(options: RegisterProcessOptions): number {
    // Check concurrency limit (0 = unlimited)
    if (this.maxProcesses > 0 && this.runningCount() >= this.maxProcesses) {
      throw new Error(
        `Maximum concurrent background processes (${this.maxProcesses}) reached. ` +
        `Stop a running process before starting a new one.`,
      );
    }

    const { handle, command, cwd, label, useProcessGroup = false, mode = 'background', onOutput } = options;

    const processId = this.nextId++;
    const output = new OutputBuffer(this.maxOutputLines);

    const entry: ProcessEntry = {
      processId,
      pid: handle.pid ?? -1,
      handle,
      command,
      label,
      cwd,
      state: 'running',
      exitCode: null,
      signal: null,
      startedAt: new Date(),
      output,
      useProcessGroup,
      mode,
    };

    // Wire up stdout/stderr capture
    handle.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      output.append(text);
      onOutput?.(processId, text, 'stdout');
    });

    handle.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      output.append(text);
      onOutput?.(processId, text, 'stderr');
    });

    // Handle process exit
    handle.on('close', (code: number | null, signal: string | null) => {
      entry.state = 'exited';
      entry.exitCode = code;
      entry.signal = signal?.toString() ?? null;
      entry.endedAt = new Date();
      output.flush();
    });

    // Handle spawn errors
    handle.on('error', (err: Error) => {
      entry.state = 'exited';
      entry.exitCode = -1;
      entry.signal = null;
      entry.endedAt = new Date();
      output.append(`[spawn error] ${err.message}\n`);
      output.flush();
    });

    this.processes.set(processId, entry);
    return processId;
  }

  /**
   * Get a process by ID.
   */
  get(processId: number): ProcessEntry | undefined {
    return this.processes.get(processId);
  }

  /**
   * List all processes, optionally filtered by state.
   */
  list(state: 'running' | 'exited' | 'all' = 'all'): ProcessEntry[] {
    const entries = Array.from(this.processes.values());
    if (state === 'all') return entries;
    return entries.filter((e) => e.state === state);
  }

  /**
   * Stop a running process.
   *
   * Sends SIGTERM, waits up to `graceMs` for the process to exit,
   * then sends SIGKILL if it's still running.
   *
   * Returns the process entry (state will be 'exited' after this resolves).
   *
   * @throws Error if the process ID is not found.
   */
  async stop(processId: number, graceMs = KILL_GRACE_MS): Promise<ProcessEntry> {
    const entry = this.processes.get(processId);
    if (!entry) {
      throw new Error(`Process #${processId} not found.`);
    }

    if (entry.state === 'exited') {
      return entry;
    }

    return this.killProcess(entry, graceMs);
  }

  /**
   * Kill all running processes (called on session end).
   *
   * Sends SIGTERM to all, waits for grace period, then SIGKILL any remaining.
   */
  async killAll(graceMs = KILL_GRACE_MS): Promise<void> {
    const running = this.list('running');
    if (running.length === 0) return;

    await Promise.all(running.map((entry) => this.killProcess(entry, graceMs)));
  }

  /**
   * Count of currently running processes.
   */
  runningCount(): number {
    let count = 0;
    for (const entry of this.processes.values()) {
      if (entry.state === 'running') count++;
    }
    return count;
  }

  /**
   * Total number of tracked processes (running + exited).
   */
  totalCount(): number {
    return this.processes.size;
  }

  /**
   * Clear all entries (running and exited). Does NOT kill processes —
   * call killAll() first if you need to stop running processes.
   */
  clear(): void {
    this.processes.clear();
  }

  // ── internal ──────────────────────────────────────────────────

  /**
   * Send a signal to a process. Uses process group kill (negative PID)
   * only when the process was spawned as detached (has a real process group).
   *
   * Falls back to handle.kill() if process group kill fails.
   */
  private sendSignal(entry: ProcessEntry, signal: NodeJS.Signals): void {
    if (entry.useProcessGroup && entry.pid > 0) {
      try {
        process.kill(-entry.pid, signal);
        return;
      } catch {
        // Process group kill failed — fall back to direct kill
      }
    }
    entry.handle.kill(signal);
  }

  /**
   * Kill a single process with SIGTERM → wait → SIGKILL.
   */
  private killProcess(entry: ProcessEntry, graceMs: number): Promise<ProcessEntry> {
    return new Promise<ProcessEntry>((resolve) => {
      // Already exited — nothing to do
      if (entry.state === 'exited') {
        resolve(entry);
        return;
      }

      const onExit = () => {
        clearTimeout(killTimer);
        resolve(entry);
      };

      // Listen for the process to exit after SIGTERM
      entry.handle.once('close', onExit);

      // Send SIGTERM
      try {
        this.sendSignal(entry, 'SIGTERM');
      } catch {
        // Process may have already exited — that's fine
        entry.handle.removeListener('close', onExit);
        resolve(entry);
        return;
      }

      // If it doesn't exit within the grace period, SIGKILL
      const killTimer = setTimeout(() => {
        if (entry.state === 'running') {
          try {
            this.sendSignal(entry, 'SIGKILL');
          } catch {
            // Already dead
          }
        }
      }, graceMs);
    });
  }

  // ── Static singleton management ────────────────────────────────

  private static _instance: ProcessRegistry | undefined;

  /**
   * Get the shared ProcessRegistry singleton (lazy-initialised).
   *
   * Used by process tools to access the session-scoped registry.
   * Call `ProcessRegistry.setInstance()` during session setup to
   * inject a properly configured registry.
   */
  static getInstance(): ProcessRegistry {
    if (!ProcessRegistry._instance) {
      ProcessRegistry._instance = new ProcessRegistry();
    }
    return ProcessRegistry._instance;
  }

  /**
   * Replace (or set) the shared process registry singleton.
   * Used for session lifecycle management and testing.
   */
  static setInstance(registry: ProcessRegistry): void {
    ProcessRegistry._instance = registry;
  }

  /**
   * Get the current shared process registry singleton (if any).
   * Returns undefined if no instance has been created.
   */
  static getInstanceOrUndefined(): ProcessRegistry | undefined {
    return ProcessRegistry._instance;
  }

  /**
   * Clear the shared singleton. Primarily for test cleanup.
   */
  static clearInstance(): void {
    ProcessRegistry._instance = undefined;
  }
}
