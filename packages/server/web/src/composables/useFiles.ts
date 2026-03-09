import { ref } from 'vue';
import { useApi } from './useApi.js';
import { useTools } from './useTools.js';
import type { ToolResult } from './useTools.js';

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: TreeNode[] | null; // null = directory, not yet loaded
  expanded?: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  modifiedAt: string;
}

// Module-level state (shared across all usages, same pattern as useProcesses)
const tree = ref<TreeNode[]>([]);
const selectedPath = ref<string | null>(null);
const fileContent = ref<FileContent | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

export function useFiles() {
  const api = useApi();
  const tools = useTools();

  async function loadTree(path?: string, depth: number = 2): Promise<TreeNode[]> {
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      params.set('depth', String(depth));
      const result = await api.get<TreeNode[]>(`/files/tree?${params}`);
      if (!path) {
        tree.value = result;
      }
      return result;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load tree';
      return [];
    } finally {
      loading.value = false;
    }
  }

  async function loadFileContent(path: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const result = await api.get<FileContent>(`/files/content?path=${encodeURIComponent(path)}`);
      fileContent.value = result;
      selectedPath.value = path;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load file';
    } finally {
      loading.value = false;
    }
  }

  async function expandNode(node: TreeNode): Promise<TreeNode[]> {
    const params = new URLSearchParams({ path: node.path, depth: '1' });
    const children = await api.get<TreeNode[]>(`/files/tree?${params}`);
    node.children = children;
    node.expanded = true;
    return children;
  }

  async function writeFile(path: string, content: string): Promise<ToolResult> {
    return tools.execute('file_write', { path, content });
  }

  function selectPath(path: string | null) {
    selectedPath.value = path;
  }

  return {
    tree,
    selectedPath,
    fileContent,
    loading,
    error,
    loadTree,
    loadFileContent,
    expandNode,
    writeFile,
    selectPath,
  };
}
