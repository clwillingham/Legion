import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  resolveCwd,
  isBlocked,
  truncateOutput,
  processExecTool,
  processStartTool,
  processStatusTool,
  processStopTool,
  processListTool,
  setProcessRegistry,
} from './process-tools.js';
import { ProcessRegistry } from '../process/ProcessRegistry.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';

// ── Mock child_process ─────────────────────────────────────────

// We'll mock the spawn function at the module level
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
const mockSpawn = vi.mocked(spawn);

/**
 * Create a mock ChildProcess for testing.
 * Returns helpers to emit stdout/stderr/close/error events.
 */
function createMockChild(pid = 9999): {
  child: ChildProcess;
  emitStdout: (data: string) => void;
  emitStderr: (data: string) => void;
  emitClose: (code: number | null, signal?: string | null) => void;
  emitError: (err: Error) => void;
} {
  const child = new EventEmitter() as unknown as ChildProcess;
  const stdoutEmitter = new EventEmitter() as unknown as Readable;
  const stderrEmitter = new EventEmitter() as unknown as Readable;

  (child as unknown as { pid: number }).pid = pid;
  (child as unknown as { stdout: Readable }).stdout = stdoutEmitter;
  (child as unknown as { stderr: Readable }).stderr = stderrEmitter;
  (child as unknown as { kill: (signal?: string) => boolean }).kill = vi.fn(() => true);
  (child as unknown as { unref: () => void }).unref = vi.fn();

  return {
    child,
    emitStdout: (data: string) => stdoutEmitter.emit('data', Buffer.from(data)),
    emitStderr: (data: string) => stderrEmitter.emit('data', Buffer.from(data)),
    emitClose: (code, signal = null) => child.emit('close', code, signal),
    emitError: (err) => child.emit('error', err),
  };
}

/**
 * Minimal RuntimeContext stub for tool tests.
 * Process tools currently only use context for config resolution
 * (which falls back to defaults), so these fields are mostly unused.
 */
function createMockContext(): RuntimeContext {
  return {} as unknown as RuntimeContext;
}

// ============================================================
// Helper functions
// ============================================================

describe('resolveCwd', () => {
  const workspaceRoot = '/home/user/project';

  it('returns workspace root when cwd is undefined', () => {
    expect(resolveCwd(undefined, workspaceRoot)).toBe(workspaceRoot);
  });

  it('resolves relative paths against workspace root', () => {
    expect(resolveCwd('src', workspaceRoot)).toBe('/home/user/project/src');
  });

  it('accepts absolute paths within workspace', () => {
    expect(resolveCwd('/home/user/project/lib', workspaceRoot)).toBe(
      '/home/user/project/lib',
    );
  });

  it('rejects paths outside the workspace', () => {
    const result = resolveCwd('/etc/passwd', workspaceRoot);
    expect(result).toEqual(
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('rejects relative paths that escape the workspace', () => {
    const result = resolveCwd('../../other', workspaceRoot);
    expect(result).toEqual(
      expect.objectContaining({ status: 'error' }),
    );
  });
});

describe('isBlocked', () => {
  const blocklist = ['rm -rf /', 'shutdown', 'mkfs'];

  it('returns null for safe commands', () => {
    expect(isBlocked('npm test', blocklist)).toBeNull();
    expect(isBlocked('echo hello', blocklist)).toBeNull();
    expect(isBlocked('git status', blocklist)).toBeNull();
  });

  it('returns the matching pattern for blocked commands', () => {
    expect(isBlocked('rm -rf /', blocklist)).toBe('rm -rf /');
    expect(isBlocked('sudo shutdown -h now', blocklist)).toBe('shutdown');
  });

  it('is case-insensitive', () => {
    expect(isBlocked('SHUTDOWN now', blocklist)).toBe('shutdown');
    expect(isBlocked('Rm -Rf /', blocklist)).toBe('rm -rf /');
  });

  it('matches substrings', () => {
    expect(isBlocked('run mkfs.ext4 /dev/sda', blocklist)).toBe('mkfs');
  });

  it('returns null for empty blocklist', () => {
    expect(isBlocked('rm -rf /', [])).toBeNull();
  });
});

describe('truncateOutput', () => {
  it('returns output unchanged when under the limit', () => {
    const result = truncateOutput('hello world', 1000);
    expect(result.text).toBe('hello world');
    expect(result.truncated).toBe(false);
  });

  it('truncates output that exceeds the limit', () => {
    // Create output with many lines
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      lines.push(`Line ${i}: ${'x'.repeat(100)}`);
    }
    const output = lines.join('\n');

    const result = truncateOutput(output, 1000);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('[...');
    expect(result.text).toContain('bytes truncated');
    expect(Buffer.byteLength(result.text, 'utf-8')).toBeLessThan(
      Buffer.byteLength(output, 'utf-8'),
    );
  });

  it('preserves head and tail of the output', () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`Line ${i}`);
    }
    const output = lines.join('\n');

    const result = truncateOutput(output, 200);
    expect(result.truncated).toBe(true);
    // Should contain the first line
    expect(result.text).toContain('Line 0');
    // Should contain the last line
    expect(result.text).toContain('Line 99');
  });

  it('returns full output when exactly at the limit', () => {
    const output = 'a'.repeat(100);
    const result = truncateOutput(output, 100);
    expect(result.text).toBe(output);
    expect(result.truncated).toBe(false);
  });
});

// ============================================================
// process_exec
// ============================================================

describe('process_exec', () => {
  let registry: ProcessRegistry;
  const context = createMockContext();

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ProcessRegistry();
    setProcessRegistry(registry);
  });

  it('returns error for empty command', async () => {
    const result = await processExecTool.execute({ command: '' }, context);
    expect(result.status).toBe('error');
    expect(result.error).toContain('command is required');
  });

  it('returns error for missing command', async () => {
    const result = await processExecTool.execute({}, context);
    expect(result.status).toBe('error');
    expect(result.error).toContain('command is required');
  });

  it('returns error for blocked commands', async () => {
    const result = await processExecTool.execute(
      { command: 'rm -rf /' },
      context,
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('blocked');
    expect(result.error).toContain('rm -rf /');
  });

  it('returns error for cwd outside workspace', async () => {
    const result = await processExecTool.execute(
      { command: 'echo hello', cwd: '/etc' },
      context,
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('outside the workspace');
  });

  it('executes a command and returns stdout, stderr, and exit code', async () => {
    const { child, emitStdout, emitStderr, emitClose } = createMockChild(1234);
    mockSpawn.mockReturnValue(child);

    const promise = processExecTool.execute(
      { command: 'echo hello' },
      context,
    );

    // Simulate process output and exit
    emitStdout('hello world\n');
    emitStderr('some warning\n');
    emitClose(0);

    const result = await promise;
    expect(result.status).toBe('success');

    const data = result.data as Record<string, unknown>;
    expect(data.exitCode).toBe(0);
    expect(data.stdout).toBe('hello world\n');
    expect(data.stderr).toBe('some warning\n');
    expect(data.truncated).toBe(false);
    expect(typeof data.durationMs).toBe('number');
  });

  it('returns success with non-zero exit code', async () => {
    const { child, emitStderr, emitClose } = createMockChild();
    mockSpawn.mockReturnValue(child);

    const promise = processExecTool.execute(
      { command: 'npm test' },
      context,
    );

    emitStderr('Error: tests failed\n');
    emitClose(1);

    const result = await promise;
    expect(result.status).toBe('success');

    const data = result.data as Record<string, unknown>;
    expect(data.exitCode).toBe(1);
    expect(data.stderr).toContain('tests failed');
  });

  it('registers the process in the registry as sync mode', async () => {
    const { child, emitClose } = createMockChild(5555);
    mockSpawn.mockReturnValue(child);

    const promise = processExecTool.execute(
      { command: 'echo test' },
      context,
    );

    // Before exit, the process should be registered
    expect(registry.totalCount()).toBe(1);
    const entries = registry.list();
    expect(entries[0].mode).toBe('sync');
    expect(entries[0].command).toBe('echo test');

    emitClose(0);
    await promise;
  });

  it('handles spawn errors', async () => {
    const { child, emitError } = createMockChild();
    mockSpawn.mockReturnValue(child);

    const promise = processExecTool.execute(
      { command: 'nonexistent-command' },
      context,
    );

    emitError(new Error('spawn ENOENT'));

    const result = await promise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('ENOENT');
  });

  it('passes cwd to spawn', async () => {
    const { child, emitClose } = createMockChild();
    mockSpawn.mockReturnValue(child);

    const cwd = process.cwd();
    const promise = processExecTool.execute(
      { command: 'ls', cwd: '.' },
      context,
    );

    emitClose(0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith('ls', [], expect.objectContaining({
      cwd,
    }));
  });

  it('passes env vars to spawn merged with process.env', async () => {
    const { child, emitClose } = createMockChild();
    mockSpawn.mockReturnValue(child);

    const promise = processExecTool.execute(
      { command: 'echo $FOO', env: { FOO: 'bar' } },
      context,
    );

    emitClose(0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'echo $FOO',
      [],
      expect.objectContaining({
        env: expect.objectContaining({ FOO: 'bar' }),
      }),
    );
  });

  it('spawns with shell mode and stdin ignored', async () => {
    const { child, emitClose } = createMockChild();
    mockSpawn.mockReturnValue(child);

    const promise = processExecTool.execute(
      { command: 'echo hello' },
      context,
    );

    emitClose(0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'echo hello',
      [],
      expect.objectContaining({
        shell: '/bin/sh',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('truncates large output', async () => {
    const { child, emitStdout, emitClose } = createMockChild();
    mockSpawn.mockReturnValue(child);

    const promise = processExecTool.execute(
      { command: 'generate-lots' },
      context,
    );

    // Emit ~100KB of output
    const bigOutput = 'x'.repeat(100) + '\n';
    for (let i = 0; i < 1000; i++) {
      emitStdout(bigOutput);
    }

    emitClose(0);

    const result = await promise;
    expect(result.status).toBe('success');

    const data = result.data as Record<string, unknown>;
    expect(data.truncated).toBe(true);
    expect((data.stdout as string)).toContain('bytes truncated');
  });

  it('handles timeout by killing the process', async () => {
    vi.useFakeTimers();
    const { child, emitClose } = createMockChild();
    mockSpawn.mockReturnValue(child);

    const promise = processExecTool.execute(
      { command: 'sleep 100', timeout: 2 },
      context,
    );

    // Advance past the 2-second timeout
    vi.advanceTimersByTime(2_000);

    // The tool should have called kill
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    // Simulate the process exiting after being killed
    emitClose(null, 'SIGTERM');

    const result = await promise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');

    const data = result.data as Record<string, unknown>;
    expect(data.timedOut).toBe(true);

    vi.useRealTimers();
  });

  it('respects timeout of 0 (no timeout)', async () => {
    const { child, emitClose } = createMockChild();
    mockSpawn.mockReturnValue(child);

    const promise = processExecTool.execute(
      { command: 'long-running', timeout: 0 },
      context,
    );

    // Process exits normally after a while
    emitClose(0);

    const result = await promise;
    expect(result.status).toBe('success');
  });

  it('includes processId in the result data', async () => {
    const { child, emitClose } = createMockChild();
    mockSpawn.mockReturnValue(child);

    const promise = processExecTool.execute(
      { command: 'echo test' },
      context,
    );

    emitClose(0);

    const result = await promise;
    const data = result.data as Record<string, unknown>;
    expect(data.processId).toBe(1);
  });
});

// ============================================================
// process_start
// ============================================================

describe('process_start', () => {
  let registry: ProcessRegistry;
  const context = createMockContext();

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ProcessRegistry();
    setProcessRegistry(registry);
  });

  it('returns error for empty command', async () => {
    const result = await processStartTool.execute({ command: '' }, context);
    expect(result.status).toBe('error');
    expect(result.error).toContain('command is required');
  });

  it('returns error for blocked commands', async () => {
    const result = await processStartTool.execute(
      { command: 'sudo shutdown -h now' },
      context,
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('blocked');
  });

  it('returns error for cwd outside workspace', async () => {
    const result = await processStartTool.execute(
      { command: 'node server.js', cwd: '/etc' },
      context,
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('outside the workspace');
  });

  it('starts a background process and returns process info', async () => {
    const { child } = createMockChild(42_000);
    mockSpawn.mockReturnValue(child);

    const result = await processStartTool.execute(
      { command: 'npm run dev', label: 'dev-server' },
      context,
    );

    expect(result.status).toBe('success');

    const data = result.data as Record<string, unknown>;
    expect(data.processId).toBe(1);
    expect(data.pid).toBe(42_000);
    expect(data.label).toBe('dev-server');
    expect(data.command).toBe('npm run dev');
  });

  it('registers the process as background mode with useProcessGroup', async () => {
    const { child } = createMockChild(42_000);
    mockSpawn.mockReturnValue(child);

    await processStartTool.execute(
      { command: 'npm run dev' },
      context,
    );

    const entries = registry.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].mode).toBe('background');
    expect(entries[0].useProcessGroup).toBe(true);
  });

  it('spawns with detached mode', async () => {
    const { child } = createMockChild();
    mockSpawn.mockReturnValue(child);

    await processStartTool.execute(
      { command: 'node server.js' },
      context,
    );

    expect(mockSpawn).toHaveBeenCalledWith(
      'node server.js',
      [],
      expect.objectContaining({
        detached: true,
        shell: '/bin/sh',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('calls unref on the child process', async () => {
    const { child } = createMockChild();
    mockSpawn.mockReturnValue(child);

    await processStartTool.execute(
      { command: 'node server.js' },
      context,
    );

    expect(child.unref).toHaveBeenCalled();
  });

  it('passes label to the registry', async () => {
    const { child } = createMockChild();
    mockSpawn.mockReturnValue(child);

    await processStartTool.execute(
      { command: 'npm test', label: 'test-runner' },
      context,
    );

    const entry = registry.get(1);
    expect(entry?.label).toBe('test-runner');
  });

  it('returns null for label when not provided', async () => {
    const { child } = createMockChild();
    mockSpawn.mockReturnValue(child);

    const result = await processStartTool.execute(
      { command: 'npm test' },
      context,
    );

    const data = result.data as Record<string, unknown>;
    expect(data.label).toBeNull();
  });

  it('passes env vars to spawn', async () => {
    const { child } = createMockChild();
    mockSpawn.mockReturnValue(child);

    await processStartTool.execute(
      { command: 'node app.js', env: { PORT: '3000' } },
      context,
    );

    expect(mockSpawn).toHaveBeenCalledWith(
      'node app.js',
      [],
      expect.objectContaining({
        env: expect.objectContaining({ PORT: '3000' }),
      }),
    );
  });

  it('enforces the concurrency limit', async () => {
    // Create a registry with max 2 processes
    registry = new ProcessRegistry(2);
    setProcessRegistry(registry);

    // Start 2 processes
    const { child: c1 } = createMockChild(100);
    const { child: c2 } = createMockChild(200);
    const { child: c3 } = createMockChild(300);

    mockSpawn.mockReturnValueOnce(c1).mockReturnValueOnce(c2).mockReturnValueOnce(c3);

    const r1 = await processStartTool.execute({ command: 'cmd1' }, context);
    expect(r1.status).toBe('success');

    const r2 = await processStartTool.execute({ command: 'cmd2' }, context);
    expect(r2.status).toBe('success');

    // Third should fail due to concurrency limit
    const r3 = await processStartTool.execute({ command: 'cmd3' }, context);
    expect(r3.status).toBe('error');
    expect(r3.error).toContain('Maximum concurrent');
  });
});

// ============================================================
// process_status
// ============================================================

describe('process_status', () => {
  let registry: ProcessRegistry;
  const context = createMockContext();

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ProcessRegistry();
    setProcessRegistry(registry);
  });

  it('returns error for missing processId', async () => {
    const result = await processStatusTool.execute({}, context);
    expect(result.status).toBe('error');
    expect(result.error).toContain('processId is required');
  });

  it('returns error for non-existent process', async () => {
    const result = await processStatusTool.execute({ processId: 999 }, context);
    expect(result.status).toBe('error');
    expect(result.error).toContain('not found');
  });

  it('returns status for a running process', async () => {
    const { child, emitStdout } = createMockChild(1234);
    registry.register({ handle: child, command: 'npm run dev', cwd: '/project', label: 'dev-server', mode: 'background' });

    emitStdout('Server started on port 3000\n');
    emitStdout('Ready\n');

    const result = await processStatusTool.execute({ processId: 1 }, context);
    expect(result.status).toBe('success');

    const data = result.data as Record<string, unknown>;
    expect(data.processId).toBe(1);
    expect(data.state).toBe('running');
    expect(data.mode).toBe('background');
    expect(data.pid).toBe(1234);
    expect(data.label).toBe('dev-server');
    expect(data.command).toBe('npm run dev');
    expect(typeof data.uptimeMs).toBe('number');
    expect(data.recentOutput).toContain('Server started');
    expect(data.recentOutput).toContain('Ready');
    expect(data.totalOutputLines).toBe(2);
    expect(typeof data.totalOutputBytes).toBe('number');
  });

  it('returns status for an exited process', async () => {
    const { child, emitStdout, emitClose } = createMockChild(1234);
    registry.register({ handle: child, command: 'npm test', cwd: '/project', label: 'tests', mode: 'sync' });

    emitStdout('All tests passed\n');
    emitClose(0);

    const result = await processStatusTool.execute({ processId: 1 }, context);
    expect(result.status).toBe('success');

    const data = result.data as Record<string, unknown>;
    expect(data.processId).toBe(1);
    expect(data.state).toBe('exited');
    expect(data.mode).toBe('sync');
    expect(data.exitCode).toBe(0);
    expect(data.recentOutput).toContain('All tests passed');
    expect(typeof data.durationMs).toBe('number');
  });

  it('respects the lines parameter', async () => {
    const { child, emitStdout } = createMockChild();
    registry.register({ handle: child, command: 'chatty', cwd: '/project' });

    // Emit many lines
    for (let i = 0; i < 100; i++) {
      emitStdout(`Line ${i}\n`);
    }

    const result = await processStatusTool.execute({ processId: 1, lines: 5 }, context);
    const data = result.data as Record<string, unknown>;
    const output = data.recentOutput as string;
    const outputLines = output.split('\n').filter((l) => l.length > 0);
    expect(outputLines).toHaveLength(5);
    expect(output).toContain('Line 99');
    expect(output).toContain('Line 95');
  });

  it('returns null for missing label', async () => {
    const { child } = createMockChild();
    registry.register({ handle: child, command: 'echo hi', cwd: '/project' });

    const result = await processStatusTool.execute({ processId: 1 }, context);
    const data = result.data as Record<string, unknown>;
    expect(data.label).toBeNull();
  });

  it('includes cwd in the response', async () => {
    const { child } = createMockChild();
    registry.register({ handle: child, command: 'ls', cwd: '/project/src' });

    const result = await processStatusTool.execute({ processId: 1 }, context);
    const data = result.data as Record<string, unknown>;
    expect(data.cwd).toBe('/project/src');
  });
});

// ============================================================
// process_stop
// ============================================================

describe('process_stop', () => {
  let registry: ProcessRegistry;
  const context = createMockContext();

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ProcessRegistry();
    setProcessRegistry(registry);
  });

  it('returns error for missing processId', async () => {
    const result = await processStopTool.execute({}, context);
    expect(result.status).toBe('error');
    expect(result.error).toContain('processId is required');
  });

  it('returns error for non-existent process', async () => {
    const result = await processStopTool.execute({ processId: 999 }, context);
    expect(result.status).toBe('error');
    expect(result.error).toContain('not found');
  });

  it('returns success with alreadyExited flag if process already exited', async () => {
    const { child, emitStdout, emitClose } = createMockChild();
    registry.register({ handle: child, command: 'echo done', cwd: '/project' });

    emitStdout('done\n');
    emitClose(0);

    const result = await processStopTool.execute({ processId: 1 }, context);
    expect(result.status).toBe('success');

    const data = result.data as Record<string, unknown>;
    expect(data.alreadyExited).toBe(true);
    expect(data.exitCode).toBe(0);
    expect(data.finalOutput).toContain('done');
  });

  it('stops a running process and returns the result', async () => {
    const { child, emitStdout, emitClose } = createMockChild();
    registry.register({ handle: child, command: 'npm run dev', cwd: '/project', label: 'dev' });

    emitStdout('Server running\n');

    // When stop() sends SIGTERM via handle.kill(), simulate the process exiting
    (child.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
      // Defer the close event so the stop() promise can set up its listener
      setTimeout(() => emitClose(null, 'SIGTERM'), 0);
      return true;
    });

    const result = await processStopTool.execute({ processId: 1 }, context);
    expect(result.status).toBe('success');

    const data = result.data as Record<string, unknown>;
    expect(data.processId).toBe(1);
    expect(data.label).toBe('dev');
    expect(data.signal).toBe('SIGTERM');
    expect(data.finalOutput).toContain('Server running');
  });

  it('returns null label when not set', async () => {
    const { child, emitClose } = createMockChild();
    registry.register({ handle: child, command: 'some cmd', cwd: '/project' });

    emitClose(0);

    const result = await processStopTool.execute({ processId: 1 }, context);
    const data = result.data as Record<string, unknown>;
    expect(data.label).toBeNull();
  });
});

// ============================================================
// process_list
// ============================================================

describe('process_list', () => {
  let registry: ProcessRegistry;
  const context = createMockContext();

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ProcessRegistry();
    setProcessRegistry(registry);
  });

  it('returns empty list when no processes', async () => {
    const result = await processListTool.execute({}, context);
    expect(result.status).toBe('success');

    const data = result.data as Record<string, unknown>;
    expect(data.processes).toEqual([]);
    expect(data.running).toBe(0);
    expect(data.total).toBe(0);
  });

  it('lists all processes by default', async () => {
    const { child: c1, emitClose: close1 } = createMockChild(100);
    const { child: c2 } = createMockChild(200);

    registry.register({ handle: c1, command: 'npm test', cwd: '/project', label: 'tests', mode: 'sync' });
    registry.register({ handle: c2, command: 'npm run dev', cwd: '/project', label: 'server', mode: 'background' });

    // Make the first one exit
    close1(0);

    const result = await processListTool.execute({}, context);
    const data = result.data as Record<string, unknown>;
    const processes = data.processes as Array<Record<string, unknown>>;

    expect(processes).toHaveLength(2);
    expect(data.running).toBe(1);
    expect(data.total).toBe(2);
  });

  it('filters by state=running', async () => {
    const { child: c1, emitClose: close1 } = createMockChild(100);
    const { child: c2 } = createMockChild(200);

    registry.register({ handle: c1, command: 'npm test', cwd: '/project', mode: 'sync' });
    registry.register({ handle: c2, command: 'npm run dev', cwd: '/project', mode: 'background' });

    close1(0);

    const result = await processListTool.execute({ state: 'running' }, context);
    const data = result.data as Record<string, unknown>;
    const processes = data.processes as Array<Record<string, unknown>>;

    expect(processes).toHaveLength(1);
    expect(processes[0].command).toBe('npm run dev');
    expect(processes[0].state).toBe('running');
  });

  it('filters by state=exited', async () => {
    const { child: c1, emitClose: close1 } = createMockChild(100);
    const { child: c2 } = createMockChild(200);

    registry.register({ handle: c1, command: 'npm test', cwd: '/project', mode: 'sync' });
    registry.register({ handle: c2, command: 'npm run dev', cwd: '/project', mode: 'background' });

    close1(0);

    const result = await processListTool.execute({ state: 'exited' }, context);
    const data = result.data as Record<string, unknown>;
    const processes = data.processes as Array<Record<string, unknown>>;

    expect(processes).toHaveLength(1);
    expect(processes[0].command).toBe('npm test');
    expect(processes[0].state).toBe('exited');
    expect(processes[0].exitCode).toBe(0);
  });

  it('filters by mode=sync', async () => {
    const { child: c1 } = createMockChild(100);
    const { child: c2 } = createMockChild(200);

    registry.register({ handle: c1, command: 'npm test', cwd: '/project', mode: 'sync' });
    registry.register({ handle: c2, command: 'npm run dev', cwd: '/project', mode: 'background' });

    const result = await processListTool.execute({ mode: 'sync' }, context);
    const data = result.data as Record<string, unknown>;
    const processes = data.processes as Array<Record<string, unknown>>;

    expect(processes).toHaveLength(1);
    expect(processes[0].command).toBe('npm test');
    expect(processes[0].mode).toBe('sync');
  });

  it('filters by mode=background', async () => {
    const { child: c1 } = createMockChild(100);
    const { child: c2 } = createMockChild(200);

    registry.register({ handle: c1, command: 'npm test', cwd: '/project', mode: 'sync' });
    registry.register({ handle: c2, command: 'npm run dev', cwd: '/project', mode: 'background' });

    const result = await processListTool.execute({ mode: 'background' }, context);
    const data = result.data as Record<string, unknown>;
    const processes = data.processes as Array<Record<string, unknown>>;

    expect(processes).toHaveLength(1);
    expect(processes[0].command).toBe('npm run dev');
    expect(processes[0].mode).toBe('background');
  });

  it('combines state and mode filters', async () => {
    const { child: c1, emitClose: close1 } = createMockChild(100);
    const { child: c2 } = createMockChild(200);
    const { child: c3, emitClose: close3 } = createMockChild(300);

    registry.register({ handle: c1, command: 'npm test', cwd: '/project', mode: 'sync' });
    registry.register({ handle: c2, command: 'npm run dev', cwd: '/project', mode: 'background' });
    registry.register({ handle: c3, command: 'npm run build', cwd: '/project', mode: 'sync' });

    close1(0);
    close3(1);

    // Only exited sync processes
    const result = await processListTool.execute({ state: 'exited', mode: 'sync' }, context);
    const data = result.data as Record<string, unknown>;
    const processes = data.processes as Array<Record<string, unknown>>;

    expect(processes).toHaveLength(2);
    expect(processes.every((p) => p.mode === 'sync' && p.state === 'exited')).toBe(true);
  });

  it('includes uptimeMs for running processes', async () => {
    const { child } = createMockChild();
    registry.register({ handle: child, command: 'server', cwd: '/project', mode: 'background' });

    const result = await processListTool.execute({}, context);
    const data = result.data as Record<string, unknown>;
    const processes = data.processes as Array<Record<string, unknown>>;

    expect(typeof processes[0].uptimeMs).toBe('number');
    expect(processes[0].exitCode).toBeUndefined();
  });

  it('includes durationMs and exitCode for exited processes', async () => {
    const { child, emitClose } = createMockChild();
    registry.register({ handle: child, command: 'npm test', cwd: '/project', mode: 'sync' });

    emitClose(1);

    const result = await processListTool.execute({}, context);
    const data = result.data as Record<string, unknown>;
    const processes = data.processes as Array<Record<string, unknown>>;

    expect(typeof processes[0].durationMs).toBe('number');
    expect(processes[0].exitCode).toBe(1);
    expect(processes[0].uptimeMs).toBeUndefined();
  });

  it('includes the concurrency limit in response', async () => {
    const result = await processListTool.execute({}, context);
    const data = result.data as Record<string, unknown>;
    expect(data.limit).toBe(10);
  });
});
