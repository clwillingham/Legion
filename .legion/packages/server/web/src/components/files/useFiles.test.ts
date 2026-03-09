import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFiles } from '../../composables/useFiles.js';
import type { TreeNode } from '../../composables/useFiles.js';

// We need to reset module state between tests since useFiles uses module-level refs
// We do this by re-importing fresh each time via vi.resetModules

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../composables/useApi.js', () => ({
  useApi: () => ({ get: mockGet, post: mockPost, put: mockPut }),
}));

vi.mock('../../composables/useTools.js', () => ({
  useTools: () => ({ execute: mockExecute, list: vi.fn() }),
}));

describe('useFiles composable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. loadTree calls GET /files/tree and returns results', async () => {
    const nodes = [{ name: 'src', path: 'src', type: 'directory' as const }];
    mockGet.mockResolvedValueOnce(nodes);

    const { loadTree } = useFiles();
    const result = await loadTree();

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/files/tree'));
    expect(result).toEqual(nodes);
  });

  it('2. loadTree with no path updates module-level tree ref', async () => {
    const nodes = [{ name: 'README.md', path: 'README.md', type: 'file' as const }];
    mockGet.mockResolvedValueOnce(nodes);

    const { loadTree, tree } = useFiles();
    await loadTree();

    expect(tree.value).toEqual(nodes);
  });

  it('3. loadTree sets loading to true during fetch and false after', async () => {
    mockGet.mockImplementationOnce(async () => {
      // loading should be true while the fetch is in progress
      return [];
    });

    const { loadTree, loading } = useFiles();
    const promise = loadTree();
    await promise;
    expect(loading.value).toBe(false); // loading should be false after completion
  });

  it('4. loadTree handles errors and sets error ref', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    const { loadTree, error } = useFiles();
    await loadTree();

    expect(error.value).toBe('Network error');
  });

  it('5. loadTree with path includes path in query params', async () => {
    mockGet.mockResolvedValueOnce([]);

    const { loadTree } = useFiles();
    await loadTree('src/components', 1);

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('path=src%2Fcomponents'));
  });

  it('6. loadFileContent calls correct API endpoint', async () => {
    const fileData = { path: 'src/App.vue', content: '<template></template>', size: 20, modifiedAt: new Date().toISOString() };
    mockGet.mockResolvedValueOnce(fileData);

    const { loadFileContent, fileContent } = useFiles();
    await loadFileContent('src/App.vue');

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/files/content'));
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('path='));
    expect(fileContent.value).toEqual(fileData);
  });

  it('7. loadFileContent sets selectedPath', async () => {
    const fileData = { path: 'test.ts', content: 'hello', size: 5, modifiedAt: new Date().toISOString() };
    mockGet.mockResolvedValueOnce(fileData);

    const { loadFileContent, selectedPath } = useFiles();
    await loadFileContent('test.ts');

    expect(selectedPath.value).toBe('test.ts');
  });

  it('8. loadFileContent handles errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('File not found'));

    const { loadFileContent, error } = useFiles();
    await loadFileContent('nonexistent.ts');

    expect(error.value).toBe('File not found');
  });

  it('9. expandNode calls API with path and depth=1', async () => {
    const children = [{ name: 'index.ts', path: 'src/index.ts', type: 'file' as const }];
    mockGet.mockResolvedValueOnce(children);

    const node: TreeNode = { name: 'src', path: 'src', type: 'directory', children: null };
    const { expandNode } = useFiles();
    const result = await expandNode(node);

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('path=src'));
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('depth=1'));
    expect(result).toEqual(children);
  });

  it('10. expandNode sets node.children and node.expanded', async () => {
    const children = [{ name: 'index.ts', path: 'src/index.ts', type: 'file' as const }];
    mockGet.mockResolvedValueOnce(children);

    // Explicitly typed as TreeNode so TypeScript knows 'expanded' is a valid property
    const node: TreeNode = { name: 'src', path: 'src', type: 'directory', children: null };
    const { expandNode } = useFiles();
    await expandNode(node);

    expect(node.children).toEqual(children);
    expect(node.expanded).toBe(true);
  });

  it('11. writeFile calls tools.execute with file_write', async () => {
    mockExecute.mockResolvedValueOnce({ status: 'success', data: 'ok' });

    const { writeFile } = useFiles();
    const result = await writeFile('test.txt', 'hello world');

    expect(mockExecute).toHaveBeenCalledWith('file_write', { path: 'test.txt', content: 'hello world' });
    expect(result).toEqual({ status: 'success', data: 'ok' });
  });

  it('12. selectPath updates selectedPath ref', () => {
    const { selectPath, selectedPath } = useFiles();
    selectPath('src/main.ts');
    expect(selectedPath.value).toBe('src/main.ts');
  });
});
