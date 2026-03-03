/**
 * Integration tests for process management tools.
 *
 * These tests spawn REAL processes — no mocking of child_process.
 * They use safe, fast, deterministic commands: echo, sleep, seq, exit, pwd.
 *
 * Each test sets up a fresh ProcessRegistry and tears it down after.
 */

import {
  processExecTool,
  processStartTool,
  processStatusTool,
  processStopTool,
  processListTool,
} from '../tools/process-tools.js';
import { ProcessRegistry } from './ProcessRegistry.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';

// ── Helpers ────────────────────────────────────────────────────

/**
 * Create a RuntimeContext stub with optional process-management config.
 *
 * Integration tests don't need a full context — tools fall back to
 * defaults for missing fields. The config override lets us control
 * maxOutputSize, blocklist, etc. for specific tests.
 */
function createContext(
  processConfig?: Record<string, unknown>,
): RuntimeContext {
  return {
    config: {
      get: (key: string) => {
        if (key === 'processManagement') return processConfig;
        return undefined;
      },
    },
  } as unknown as RuntimeContext;
}

/** Convenience: wait for a given number of milliseconds. */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ============================================================
// Integration tests — REAL processes, no mocking
// ============================================================

describe('Process Tools – Integration Tests', () => {
  const ctx = createContext();

  beforeEach(() => {
    ProcessRegistry.setInstance(new ProcessRegistry());
  });

  afterEach(async () => {
    const reg = ProcessRegistry.getInstanceOrUndefined();
    if (reg) await reg.killAll(2_000);
    ProcessRegistry.clearInstance();
  });

  // ── process_exec: basic execution ────────────────────────────

  describe('process_exec – basic execution', () => {
    it('runs a command and captures stdout', async () => {
      const result = await processExecTool.execute({ command: 'echo hello world' }, ctx);
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect((data.stdout as string).trim()).toBe('hello world');
      expect(data.exitCode).toBe(0);
    });

    it('captures stderr output', async () => {
      const result = await processExecTool.execute({ command: 'echo error >&2' }, ctx);
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect((data.stderr as string).trim()).toBe('error');
    });

    it('returns non-zero exit code with status success', async () => {
      const result = await processExecTool.execute({ command: 'exit 42' }, ctx);
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect(data.exitCode).toBe(42);
    });

    it('captures both stdout and stderr', async () => {
      const result = await processExecTool.execute(
        { command: 'echo out && echo err >&2' },
        ctx,
      );
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect((data.stdout as string).trim()).toBe('out');
      expect((data.stderr as string).trim()).toBe('err');
    });

    it('reports durationMs', async () => {
      const result = await processExecTool.execute({ command: 'echo fast' }, ctx);
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect(data.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('registers process in the registry', async () => {
      const reg = ProcessRegistry.getInstance();
      expect(reg.totalCount()).toBe(0);

      await processExecTool.execute({ command: 'echo tracked' }, ctx);

      expect(reg.totalCount()).toBe(1);
      const entries = reg.list('all');
      expect(entries[0].command).toBe('echo tracked');
      expect(entries[0].mode).toBe('sync');
      expect(entries[0].state).toBe('exited');
    });
  });

  // ── process_exec: timeout ────────────────────────────────────

  describe('process_exec – timeout', () => {
    it(
      'kills a process that exceeds the timeout',
      async () => {
        const result = await processExecTool.execute(
          { command: 'sleep 30', timeout: 1 },
          ctx,
        );
        expect(result.status).toBe('error');
        expect(result.error).toContain('timed out');
        const data = result.data as Record<string, unknown>;
        expect(data.timedOut).toBe(true);
      },
      15_000,
    );

    it(
      'timeout of 0 means no timeout',
      async () => {
        // Run a very fast command with timeout=0 — should succeed
        const result = await processExecTool.execute(
          { command: 'echo no-timeout', timeout: 0 },
          ctx,
        );
        expect(result.status).toBe('success');
        const data = result.data as Record<string, unknown>;
        expect((data.stdout as string).trim()).toBe('no-timeout');
      },
    );
  });

  // ── process_exec: output truncation ──────────────────────────

  describe('process_exec – output truncation', () => {
    it('truncates output exceeding maxOutputSize', async () => {
      // Use a context with a very small maxOutputSize (512 bytes)
      const smallCtx = createContext({ maxOutputSize: 512 });
      const result = await processExecTool.execute(
        { command: 'seq 1 1000' },
        smallCtx,
      );
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect(data.truncated).toBe(true);
      // The truncation marker should appear in stdout
      expect(data.stdout as string).toContain('truncated');
    });

    it('does not truncate small output', async () => {
      const result = await processExecTool.execute({ command: 'echo small' }, ctx);
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect(data.truncated).toBe(false);
    });
  });

  // ── process_exec: working directory ──────────────────────────

  describe('process_exec – working directory', () => {
    it('uses workspace root as default cwd', async () => {
      const result = await processExecTool.execute({ command: 'pwd' }, ctx);
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect((data.stdout as string).trim()).toBe(process.cwd());
    });

    it('accepts relative cwd within workspace', async () => {
      const result = await processExecTool.execute(
        { command: 'pwd', cwd: 'packages' },
        ctx,
      );
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect((data.stdout as string).trim()).toBe(`${process.cwd()}/packages`);
    });

    it('rejects absolute cwd outside workspace', async () => {
      const result = await processExecTool.execute(
        { command: 'pwd', cwd: '/tmp' },
        ctx,
      );
      expect(result.status).toBe('error');
      expect(result.error).toContain('outside the workspace');
    });
  });

  // ── Blocklist ────────────────────────────────────────────────

  describe('blocklist rejection', () => {
    it('rejects commands matching the default blocklist', async () => {
      const result = await processExecTool.execute(
        { command: 'rm -rf /' },
        ctx,
      );
      expect(result.status).toBe('error');
      expect(result.error).toContain('blocked');
    });

    it('rejects commands matching a custom blocklist', async () => {
      const customCtx = createContext({ blocklist: ['forbidden-cmd'] });
      const result = await processExecTool.execute(
        { command: 'forbidden-cmd --yes' },
        customCtx,
      );
      expect(result.status).toBe('error');
      expect(result.error).toContain('blocked');
    });

    it('allows non-blocked commands through', async () => {
      const result = await processExecTool.execute(
        { command: 'echo safe' },
        ctx,
      );
      expect(result.status).toBe('success');
    });
  });

  // ── process_start + process_status + process_stop ────────────

  describe('process_start lifecycle', () => {
    it(
      'starts, checks status, and stops a background process',
      async () => {
        // Start
        const startResult = await processStartTool.execute(
          { command: 'sleep 60', label: 'test-bg' },
          ctx,
        );
        expect(startResult.status).toBe('success');
        const startData = startResult.data as Record<string, unknown>;
        const processId = startData.processId as number;
        expect(processId).toBeDefined();
        expect(startData.pid).toBeGreaterThan(0);
        expect(startData.label).toBe('test-bg');

        await delay(200);

        // Status — should be running
        const statusResult = await processStatusTool.execute({ processId }, ctx);
        expect(statusResult.status).toBe('success');
        const statusData = statusResult.data as Record<string, unknown>;
        expect(statusData.state).toBe('running');
        expect(statusData.mode).toBe('background');
        expect(statusData.label).toBe('test-bg');
        expect(statusData.uptimeMs).toBeGreaterThan(0);

        // Stop
        const stopResult = await processStopTool.execute({ processId }, ctx);
        expect(stopResult.status).toBe('success');
        const stopData = stopResult.data as Record<string, unknown>;
        expect(stopData.processId).toBe(processId);

        // Verify it's now exited
        const afterStop = await processStatusTool.execute({ processId }, ctx);
        expect(afterStop.status).toBe('success');
        const afterData = afterStop.data as Record<string, unknown>;
        expect(afterData.state).toBe('exited');
      },
      15_000,
    );

    it(
      'captures output from a background process',
      async () => {
        const startResult = await processStartTool.execute(
          { command: 'echo background-output && sleep 60' },
          ctx,
        );
        expect(startResult.status).toBe('success');
        const { processId } = startResult.data as { processId: number };

        // Wait for echo to produce output
        await delay(500);

        const statusResult = await processStatusTool.execute(
          { processId, lines: 10 },
          ctx,
        );
        expect(statusResult.status).toBe('success');
        const data = statusResult.data as Record<string, unknown>;
        expect(data.recentOutput).toContain('background-output');
      },
      10_000,
    );

    it('process_stop on already-exited process returns success', async () => {
      // Start a process that exits immediately
      const startResult = await processStartTool.execute(
        { command: 'echo done' },
        ctx,
      );
      expect(startResult.status).toBe('success');
      const { processId } = startResult.data as { processId: number };

      // Wait for it to exit naturally
      await delay(500);

      const stopResult = await processStopTool.execute({ processId }, ctx);
      expect(stopResult.status).toBe('success');
      const data = stopResult.data as Record<string, unknown>;
      expect(data.alreadyExited).toBe(true);
    });
  });

  // ── process_list ─────────────────────────────────────────────

  describe('process_list', () => {
    it(
      'lists both running and exited processes',
      async () => {
        // Run a quick sync command (becomes exited)
        await processExecTool.execute({ command: 'echo done' }, ctx);

        // Start a background process (stays running)
        await processStartTool.execute({ command: 'sleep 60' }, ctx);
        await delay(100);

        const result = await processListTool.execute({}, ctx);
        expect(result.status).toBe('success');
        const data = result.data as Record<string, unknown>;
        expect(data.total).toBe(2);
        expect(data.running).toBe(1);
        expect((data.processes as unknown[]).length).toBe(2);
      },
      10_000,
    );

    it(
      'filters by state',
      async () => {
        await processExecTool.execute({ command: 'echo done' }, ctx);
        await processStartTool.execute({ command: 'sleep 60' }, ctx);
        await delay(100);

        const runningResult = await processListTool.execute({ state: 'running' }, ctx);
        const runP = (runningResult.data as Record<string, unknown>).processes as Record<string, unknown>[];
        expect(runP).toHaveLength(1);
        expect(runP[0].state).toBe('running');

        const exitedResult = await processListTool.execute({ state: 'exited' }, ctx);
        const exitP = (exitedResult.data as Record<string, unknown>).processes as Record<string, unknown>[];
        expect(exitP).toHaveLength(1);
        expect(exitP[0].state).toBe('exited');
      },
      10_000,
    );

    it(
      'filters by mode',
      async () => {
        await processExecTool.execute({ command: 'echo sync-cmd' }, ctx);
        await processStartTool.execute({ command: 'sleep 60' }, ctx);
        await delay(100);

        const bgResult = await processListTool.execute({ mode: 'background' }, ctx);
        const bgP = (bgResult.data as Record<string, unknown>).processes as Record<string, unknown>[];
        expect(bgP).toHaveLength(1);
        expect(bgP[0].mode).toBe('background');

        const syncResult = await processListTool.execute({ mode: 'sync' }, ctx);
        const syncP = (syncResult.data as Record<string, unknown>).processes as Record<string, unknown>[];
        expect(syncP).toHaveLength(1);
        expect(syncP[0].mode).toBe('sync');
      },
      10_000,
    );
  });

  // ── Concurrency limit ───────────────────────────────────────

  describe('concurrency limit', () => {
    it(
      'rejects process_start when max concurrent processes reached',
      async () => {
        // Create a registry with a strict limit of 2
        ProcessRegistry.setInstance(new ProcessRegistry(2));

        const r1 = await processStartTool.execute({ command: 'sleep 60' }, ctx);
        expect(r1.status).toBe('success');

        const r2 = await processStartTool.execute({ command: 'sleep 60' }, ctx);
        expect(r2.status).toBe('success');

        // Third should fail — use a very short sleep to minimize leaked process
        const r3 = await processStartTool.execute({ command: 'sleep 0.1' }, ctx);
        expect(r3.status).toBe('error');
        expect(r3.error).toContain('Maximum concurrent');
      },
      15_000,
    );
  });

  // ── Session cleanup ──────────────────────────────────────────

  describe('session cleanup', () => {
    it(
      'killAll stops all running background processes',
      async () => {
        const reg = ProcessRegistry.getInstance();

        await processStartTool.execute({ command: 'sleep 60' }, ctx);
        await processStartTool.execute({ command: 'sleep 60' }, ctx);
        await delay(200);

        expect(reg.runningCount()).toBe(2);

        await reg.killAll(3_000);

        expect(reg.runningCount()).toBe(0);
        // Entries are still tracked, just in exited state
        expect(reg.totalCount()).toBe(2);

        const entries = reg.list('exited');
        expect(entries).toHaveLength(2);
      },
      15_000,
    );
  });

  // ── Edge cases ───────────────────────────────────────────────

  describe('edge cases', () => {
    it('rejects empty command', async () => {
      const result = await processExecTool.execute({ command: '' }, ctx);
      expect(result.status).toBe('error');
      expect(result.error).toContain('command is required');
    });

    it('rejects missing command', async () => {
      const result = await processExecTool.execute({}, ctx);
      expect(result.status).toBe('error');
      expect(result.error).toContain('command is required');
    });

    it('handles command that writes to both streams and exits non-zero', async () => {
      const result = await processExecTool.execute(
        { command: 'echo stdout-line && echo stderr-line >&2 && exit 7' },
        ctx,
      );
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect((data.stdout as string).trim()).toBe('stdout-line');
      expect((data.stderr as string).trim()).toBe('stderr-line');
      expect(data.exitCode).toBe(7);
    });

    it('process_status for non-existent process returns error', async () => {
      const result = await processStatusTool.execute({ processId: 999 }, ctx);
      expect(result.status).toBe('error');
      expect(result.error).toContain('not found');
    });

    it('process_stop for non-existent process returns error', async () => {
      const result = await processStopTool.execute({ processId: 999 }, ctx);
      expect(result.status).toBe('error');
      expect(result.error).toContain('not found');
    });

    it('handles environment variables', async () => {
      const result = await processExecTool.execute(
        { command: 'echo $LEGION_TEST_VAR', env: { LEGION_TEST_VAR: 'test-value-123' } },
        ctx,
      );
      expect(result.status).toBe('success');
      const data = result.data as Record<string, unknown>;
      expect((data.stdout as string).trim()).toBe('test-value-123');
    });
  });
});
