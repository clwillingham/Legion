import { EventEmitter } from 'node:events';
import { ProcessRegistry } from './ProcessRegistry.js';
import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

// ── Mock ChildProcess ──────────────────────────────────────────

/**
 * Minimal mock for ChildProcess used by ProcessRegistry.
 * Emits 'data' on stdout/stderr, 'close', and 'error' events.
 */
function createMockProcess(pid = 1234): {
  process: ChildProcess;
  emitStdout: (data: string) => void;
  emitStderr: (data: string) => void;
  emitClose: (code: number | null, signal?: string | null) => void;
  emitError: (err: Error) => void;
} {
  const proc = new EventEmitter() as unknown as ChildProcess;
  const stdoutEmitter = new EventEmitter() as unknown as Readable;
  const stderrEmitter = new EventEmitter() as unknown as Readable;

  (proc as unknown as { pid: number }).pid = pid;
  (proc as unknown as { stdout: Readable }).stdout = stdoutEmitter;
  (proc as unknown as { stderr: Readable }).stderr = stderrEmitter;
  (proc as unknown as { kill: (signal?: string) => boolean }).kill = vi.fn(() => true);

  return {
    process: proc,
    emitStdout: (data: string) => stdoutEmitter.emit('data', Buffer.from(data)),
    emitStderr: (data: string) => stderrEmitter.emit('data', Buffer.from(data)),
    emitClose: (code, signal = null) => proc.emit('close', code, signal),
    emitError: (err) => proc.emit('error', err),
  };
}

// ============================================================
// ProcessRegistry
// ============================================================

describe('ProcessRegistry', () => {
  // ── register ──────────────────────────────────────────────

  describe('register', () => {
    it('assigns incrementing process IDs', () => {
      const registry = new ProcessRegistry();
      const { process: p1 } = createMockProcess(100);
      const { process: p2 } = createMockProcess(200);

      const id1 = registry.register({ handle: p1, command: 'echo 1', cwd: '/tmp' });
      const id2 = registry.register({ handle: p2, command: 'echo 2', cwd: '/tmp' });

      expect(id1).toBe(1);
      expect(id2).toBe(2);
    });

    it('stores the process entry with correct fields', () => {
      const registry = new ProcessRegistry();
      const { process: proc } = createMockProcess(5678);

      const id = registry.register({
        handle: proc,
        command: 'npm test',
        cwd: '/project',
        label: 'tests',
      });

      const entry = registry.get(id);
      expect(entry).toBeDefined();
      expect(entry!.pid).toBe(5678);
      expect(entry!.command).toBe('npm test');
      expect(entry!.cwd).toBe('/project');
      expect(entry!.label).toBe('tests');
      expect(entry!.state).toBe('running');
      expect(entry!.exitCode).toBeNull();
      expect(entry!.signal).toBeNull();
      expect(entry!.startedAt).toBeInstanceOf(Date);
    });

    it('captures stdout into the output buffer', () => {
      const registry = new ProcessRegistry();
      const { process: proc, emitStdout } = createMockProcess();

      const id = registry.register({ handle: proc, command: 'test', cwd: '/' });
      emitStdout('hello from stdout\n');

      const entry = registry.get(id)!;
      expect(entry.output.lineCount()).toBe(1);
      expect(entry.output.all()).toBe('hello from stdout');
    });

    it('captures stderr into the output buffer', () => {
      const registry = new ProcessRegistry();
      const { process: proc, emitStderr } = createMockProcess();

      const id = registry.register({ handle: proc, command: 'test', cwd: '/' });
      emitStderr('error output\n');

      const entry = registry.get(id)!;
      expect(entry.output.lineCount()).toBe(1);
      expect(entry.output.all()).toBe('error output');
    });

    it('interleaves stdout and stderr into a single buffer', () => {
      const registry = new ProcessRegistry();
      const { process: proc, emitStdout, emitStderr } = createMockProcess();

      const id = registry.register({ handle: proc, command: 'test', cwd: '/' });
      emitStdout('out1\n');
      emitStderr('err1\n');
      emitStdout('out2\n');

      const entry = registry.get(id)!;
      expect(entry.output.lineCount()).toBe(3);
      expect(entry.output.all()).toBe('out1\nerr1\nout2');
    });

    it('transitions to exited on close event', () => {
      const registry = new ProcessRegistry();
      const { process: proc, emitClose } = createMockProcess();

      const id = registry.register({ handle: proc, command: 'test', cwd: '/' });
      emitClose(0);

      const entry = registry.get(id)!;
      expect(entry.state).toBe('exited');
      expect(entry.exitCode).toBe(0);
      expect(entry.endedAt).toBeInstanceOf(Date);
    });

    it('captures exit signal on close', () => {
      const registry = new ProcessRegistry();
      const { process: proc, emitClose } = createMockProcess();

      const id = registry.register({ handle: proc, command: 'test', cwd: '/' });
      emitClose(null, 'SIGTERM');

      const entry = registry.get(id)!;
      expect(entry.state).toBe('exited');
      expect(entry.exitCode).toBeNull();
      expect(entry.signal).toBe('SIGTERM');
    });

    it('handles spawn errors', () => {
      const registry = new ProcessRegistry();
      const { process: proc, emitError } = createMockProcess();

      const id = registry.register({ handle: proc, command: 'nonexistent', cwd: '/' });
      emitError(new Error('spawn ENOENT'));

      const entry = registry.get(id)!;
      expect(entry.state).toBe('exited');
      expect(entry.exitCode).toBe(-1);
      expect(entry.output.all()).toContain('spawn ENOENT');
    });

    it('flushes output buffer on close', () => {
      const registry = new ProcessRegistry();
      const { process: proc, emitStdout, emitClose } = createMockProcess();

      const id = registry.register({ handle: proc, command: 'test', cwd: '/' });
      // Send output without trailing newline
      emitStdout('partial output');
      emitClose(0);

      const entry = registry.get(id)!;
      expect(entry.output.lineCount()).toBe(1);
      expect(entry.output.all()).toBe('partial output');
    });
  });

  // ── concurrency limit ─────────────────────────────────────

  describe('concurrency limit', () => {
    it('enforces max concurrent processes', () => {
      const registry = new ProcessRegistry(2);
      const { process: p1 } = createMockProcess(1);
      const { process: p2 } = createMockProcess(2);
      const { process: p3 } = createMockProcess(3);

      registry.register({ handle: p1, command: 'cmd1', cwd: '/' });
      registry.register({ handle: p2, command: 'cmd2', cwd: '/' });

      expect(() => {
        registry.register({ handle: p3, command: 'cmd3', cwd: '/' });
      }).toThrow(/Maximum concurrent background processes \(2\) reached/);
    });

    it('allows new processes after previous ones exit', () => {
      const registry = new ProcessRegistry(1);
      const { process: p1, emitClose: close1 } = createMockProcess(1);
      const { process: p2 } = createMockProcess(2);

      registry.register({ handle: p1, command: 'cmd1', cwd: '/' });
      close1(0); // Process 1 exits

      // Should now be allowed
      expect(() => {
        registry.register({ handle: p2, command: 'cmd2', cwd: '/' });
      }).not.toThrow();
    });

    it('allows unlimited processes when maxProcesses is 0', () => {
      const registry = new ProcessRegistry(0);

      for (let i = 0; i < 20; i++) {
        const { process: p } = createMockProcess(i);
        expect(() => {
          registry.register({ handle: p, command: `cmd${i}`, cwd: '/' });
        }).not.toThrow();
      }

      expect(registry.runningCount()).toBe(20);
    });
  });

  // ── get ───────────────────────────────────────────────────

  describe('get', () => {
    it('returns undefined for unknown process ID', () => {
      const registry = new ProcessRegistry();
      expect(registry.get(999)).toBeUndefined();
    });

    it('returns the correct entry', () => {
      const registry = new ProcessRegistry();
      const { process: p } = createMockProcess();
      const id = registry.register({ handle: p, command: 'test', cwd: '/' });
      expect(registry.get(id)?.command).toBe('test');
    });
  });

  // ── list ──────────────────────────────────────────────────

  describe('list', () => {
    it('lists all processes', () => {
      const registry = new ProcessRegistry();
      const { process: p1, emitClose: close1 } = createMockProcess(1);
      const { process: p2 } = createMockProcess(2);

      registry.register({ handle: p1, command: 'cmd1', cwd: '/' });
      close1(0);
      registry.register({ handle: p2, command: 'cmd2', cwd: '/' });

      expect(registry.list('all')).toHaveLength(2);
    });

    it('filters by running state', () => {
      const registry = new ProcessRegistry();
      const { process: p1, emitClose: close1 } = createMockProcess(1);
      const { process: p2 } = createMockProcess(2);

      registry.register({ handle: p1, command: 'cmd1', cwd: '/' });
      close1(0);
      registry.register({ handle: p2, command: 'cmd2', cwd: '/' });

      const running = registry.list('running');
      expect(running).toHaveLength(1);
      expect(running[0].command).toBe('cmd2');
    });

    it('filters by exited state', () => {
      const registry = new ProcessRegistry();
      const { process: p1, emitClose: close1 } = createMockProcess(1);
      const { process: p2 } = createMockProcess(2);

      registry.register({ handle: p1, command: 'cmd1', cwd: '/' });
      close1(0);
      registry.register({ handle: p2, command: 'cmd2', cwd: '/' });

      const exited = registry.list('exited');
      expect(exited).toHaveLength(1);
      expect(exited[0].command).toBe('cmd1');
    });

    it('defaults to all when no state specified', () => {
      const registry = new ProcessRegistry();
      const { process: p1 } = createMockProcess(1);
      registry.register({ handle: p1, command: 'cmd1', cwd: '/' });

      expect(registry.list()).toHaveLength(1);
    });
  });

  // ── runningCount / totalCount ─────────────────────────────

  describe('counts', () => {
    it('runningCount reflects current running processes', () => {
      const registry = new ProcessRegistry();
      const { process: p1, emitClose: close1 } = createMockProcess(1);
      const { process: p2 } = createMockProcess(2);

      registry.register({ handle: p1, command: 'cmd1', cwd: '/' });
      registry.register({ handle: p2, command: 'cmd2', cwd: '/' });
      expect(registry.runningCount()).toBe(2);

      close1(0);
      expect(registry.runningCount()).toBe(1);
    });

    it('totalCount includes both running and exited', () => {
      const registry = new ProcessRegistry();
      const { process: p1, emitClose: close1 } = createMockProcess(1);
      const { process: p2 } = createMockProcess(2);

      registry.register({ handle: p1, command: 'cmd1', cwd: '/' });
      close1(0);
      registry.register({ handle: p2, command: 'cmd2', cwd: '/' });

      expect(registry.totalCount()).toBe(2);
    });
  });

  // ── stop ──────────────────────────────────────────────────

  describe('stop', () => {
    it('throws for unknown process ID', async () => {
      const registry = new ProcessRegistry();
      await expect(registry.stop(999)).rejects.toThrow('Process #999 not found');
    });

    it('returns immediately for already-exited process', async () => {
      const registry = new ProcessRegistry();
      const { process: proc, emitClose } = createMockProcess();
      const id = registry.register({ handle: proc, command: 'test', cwd: '/' });
      emitClose(0);

      const entry = await registry.stop(id);
      expect(entry.state).toBe('exited');
    });

    it('sends SIGTERM and resolves when process exits', async () => {
      const registry = new ProcessRegistry();
      const { process: proc, emitClose } = createMockProcess(5678);
      const id = registry.register({ handle: proc, command: 'test', cwd: '/' });

      // Simulate process exiting shortly after SIGTERM
      const stopPromise = registry.stop(id, 5000);
      // Give the stop call time to send SIGTERM
      await new Promise((r) => setTimeout(r, 10));
      emitClose(null, 'SIGTERM');

      const entry = await stopPromise;
      expect(entry.state).toBe('exited');
      expect(entry.signal).toBe('SIGTERM');
    });

    it('sends SIGKILL after grace period if process does not exit', async () => {
      const registry = new ProcessRegistry();
      const { process: proc, emitClose } = createMockProcess(5678);
      const id = registry.register({ handle: proc, command: 'stubborn', cwd: '/' });

      // Use a very short grace period for testing
      const stopPromise = registry.stop(id, 50);

      // Simulate process exiting after SIGKILL (after the grace period)
      setTimeout(() => emitClose(null, 'SIGKILL'), 80);

      const entry = await stopPromise;
      expect(entry.state).toBe('exited');
    });
  });

  // ── killAll ───────────────────────────────────────────────

  describe('killAll', () => {
    it('kills all running processes', async () => {
      const registry = new ProcessRegistry();
      const { process: p1, emitClose: close1 } = createMockProcess(1);
      const { process: p2, emitClose: close2 } = createMockProcess(2);
      const { process: p3, emitClose: close3 } = createMockProcess(3);

      registry.register({ handle: p1, command: 'cmd1', cwd: '/' });
      registry.register({ handle: p2, command: 'cmd2', cwd: '/' });
      registry.register({ handle: p3, command: 'cmd3', cwd: '/' });

      // Exit one before killAll
      close3(0);
      expect(registry.runningCount()).toBe(2);

      // Simulate both remaining processes exiting after SIGTERM
      const killPromise = registry.killAll(50);
      await new Promise((r) => setTimeout(r, 10));
      close1(null, 'SIGTERM');
      close2(null, 'SIGTERM');

      await killPromise;
      expect(registry.runningCount()).toBe(0);
    });

    it('is a no-op when no processes are running', async () => {
      const registry = new ProcessRegistry();
      // Should not throw
      await registry.killAll();
    });
  });

  // ── clear ─────────────────────────────────────────────────

  describe('clear', () => {
    it('removes all entries', () => {
      const registry = new ProcessRegistry();
      const { process: p1 } = createMockProcess(1);
      const { process: p2 } = createMockProcess(2);

      registry.register({ handle: p1, command: 'cmd1', cwd: '/' });
      registry.register({ handle: p2, command: 'cmd2', cwd: '/' });

      registry.clear();
      expect(registry.totalCount()).toBe(0);
      expect(registry.runningCount()).toBe(0);
    });
  });
});
