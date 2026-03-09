/**
 * Tests for BUG-001: file tools must use context.workspaceRoot, not context.storage.resolve('.')
 *
 * The root cause: context.storage is scoped to .legion/, so storage.resolve('.') returns
 * the .legion/ directory path — not the workspace root. File tools must use
 * context.workspaceRoot which holds the actual workspace root.
 */
import { tmpdir } from 'node:os';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';
import { fileWriteTool } from './file-write.js';
import { fileReadTool } from './file-read.js';
import {
  fileAnalyzeTool,
  directoryListTool,
  fileAppendTool,
  fileEditTool,
  fileDeleteTool,
  fileMoveTool,
  fileSearchTool,
  fileGrepTool,
} from './file-tools.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a minimal RuntimeContext stub where:
 *  - workspaceRoot → real temp directory (the actual workspace)
 *  - storage.resolve('.') → workspaceRoot + '/.legion' (simulating the real bug scenario)
 *
 * This setup is the exact condition that triggers BUG-001: if a tool uses
 * storage.resolve('.') it would operate in .legion/; if it uses workspaceRoot
 * it operates in the correct workspace root.
 */
function createMockContext(workspaceRoot: string): RuntimeContext {
  return {
    workspaceRoot,
    storage: {
      // Intentionally returns .legion/ path to simulate the real workspace setup
      resolve: (p: string) => join(workspaceRoot, '.legion', p),
    },
    participant: {
      id: 'agent-1',
      type: 'agent',
      name: 'Test Agent',
      description: '',
      tools: {},
      approvalAuthority: {},
      status: 'active',
      model: { provider: 'anthropic', model: 'claude-opus-4-5' },
      systemPrompt: '',
      createdBy: 'test',
      createdAt: new Date().toISOString(),
    },
    conversation: null as unknown as RuntimeContext['conversation'],
    session: null as unknown as RuntimeContext['session'],
    communicationDepth: 0,
    toolRegistry: {} as RuntimeContext['toolRegistry'],
    config: {} as RuntimeContext['config'],
    eventBus: {} as RuntimeContext['eventBus'],
    authEngine: {} as RuntimeContext['authEngine'],
    pendingApprovalRegistry: {} as RuntimeContext['pendingApprovalRegistry'],
  } as RuntimeContext;
}

// ── file_write ────────────────────────────────────────────────────────────────

describe('file_write tool — workspace root resolution', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'legion-file-write-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a file to workspace root, NOT to .legion/', async () => {
    const context = createMockContext(tmpDir);
    const result = await fileWriteTool.execute({ path: 'output.txt', content: 'hello world' }, context);

    expect(result.status).toBe('success');

    // File must exist at workspace root
    const content = await readFile(join(tmpDir, 'output.txt'), 'utf-8');
    expect(content).toBe('hello world');

    // File must NOT exist inside .legion/
    await expect(stat(join(tmpDir, '.legion', 'output.txt'))).rejects.toThrow();
  });

  it('creates parent directories within workspace root', async () => {
    const context = createMockContext(tmpDir);
    const result = await fileWriteTool.execute({ path: 'src/nested/file.ts', content: 'export {}' }, context);

    expect(result.status).toBe('success');
    const content = await readFile(join(tmpDir, 'src', 'nested', 'file.ts'), 'utf-8');
    expect(content).toBe('export {}');
  });

  it('rejects paths that escape the workspace root', async () => {
    const context = createMockContext(tmpDir);
    const result = await fileWriteTool.execute({ path: '../outside.txt', content: 'bad' }, context);

    expect(result.status).toBe('error');
    expect((result as { error: string }).error).toMatch(/outside/i);
  });
});

// ── file_read ─────────────────────────────────────────────────────────────────

describe('file_read tool — workspace root resolution', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'legion-file-read-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reads a file from workspace root, NOT from .legion/', async () => {
    // Write the test file directly at workspace root
    const { writeFile, mkdir } = await import('node:fs/promises');
    await writeFile(join(tmpDir, 'readme.txt'), 'workspace content', 'utf-8');

    // Also write a decoy in .legion/ to verify we're not reading from there
    await mkdir(join(tmpDir, '.legion'), { recursive: true });
    await writeFile(join(tmpDir, '.legion', 'readme.txt'), 'legion content', 'utf-8');

    const context = createMockContext(tmpDir);
    const result = await fileReadTool.execute({ path: 'readme.txt' }, context);

    expect(result.status).toBe('success');
    expect((result as { data: string }).data).toContain('workspace content');
    expect((result as { data: string }).data).not.toContain('legion content');
  });

  it('rejects paths that escape the workspace root', async () => {
    const context = createMockContext(tmpDir);
    const result = await fileReadTool.execute({ path: '../outside.txt' }, context);

    expect(result.status).toBe('error');
  });
});

// ── file_analyze ──────────────────────────────────────────────────────────────

describe('file_analyze tool — workspace root resolution', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'legion-file-analyze-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('analyzes a file from workspace root', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(tmpDir, 'analyze-me.txt'), 'line one\nline two\n', 'utf-8');

    const context = createMockContext(tmpDir);
    const result = await fileAnalyzeTool.execute({ path: 'analyze-me.txt' }, context);

    expect(result.status).toBe('success');
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.type).toBe('file');
    expect(data.lineCount).toBe(3);
  });
});

// ── directory_list ────────────────────────────────────────────────────────────

describe('directory_list tool — workspace root resolution', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'legion-dir-list-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('lists the workspace root directory, NOT .legion/', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await writeFile(join(tmpDir, 'workspace-file.txt'), '', 'utf-8');

    // Also create a decoy in .legion/ to verify we don't accidentally list that
    await mkdir(join(tmpDir, '.legion'), { recursive: true });
    await writeFile(join(tmpDir, '.legion', 'only-in-legion.txt'), '', 'utf-8');

    const context = createMockContext(tmpDir);
    const result = await directoryListTool.execute({ path: '.' }, context);

    expect(result.status).toBe('success');
    const names = (result as { data: Array<{ name: string }> }).data.map((e) => e.name);

    expect(names).toContain('workspace-file.txt');
    // Should not be empty (i.e., it's listing workspace root, not some non-existent path)
  });
});

// ── file_append ───────────────────────────────────────────────────────────────

describe('file_append tool — workspace root resolution', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'legion-file-append-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('appends to a file in workspace root', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(tmpDir, 'log.txt'), 'first line\n', 'utf-8');

    const context = createMockContext(tmpDir);
    const result = await fileAppendTool.execute({ path: 'log.txt', content: 'second line\n' }, context);

    expect(result.status).toBe('success');
    const content = await readFile(join(tmpDir, 'log.txt'), 'utf-8');
    expect(content).toBe('first line\nsecond line\n');
  });
});

// ── file_delete ───────────────────────────────────────────────────────────────

describe('file_delete tool — workspace root resolution', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'legion-file-delete-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('deletes a file from workspace root', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(tmpDir, 'to-delete.txt'), 'bye', 'utf-8');

    const context = createMockContext(tmpDir);
    const result = await fileDeleteTool.execute({ path: 'to-delete.txt' }, context);

    expect(result.status).toBe('success');
    await expect(stat(join(tmpDir, 'to-delete.txt'))).rejects.toThrow();
  });
});
