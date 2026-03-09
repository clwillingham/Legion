import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import FilesView from './FilesView.vue';

// Mock the useFiles composable
// Use Vue refs so the template auto-unwraps them correctly (plain objects like
// { value: [] } are not refs — Vue would pass the whole object as the prop value
// rather than the unwrapped .value, causing prop type failures and crashes).
const mockLoadTree = vi.fn().mockResolvedValue([]);
const mockLoadFileContent = vi.fn().mockResolvedValue(undefined);
const mockExpandNode = vi.fn().mockResolvedValue([]);
const mockTree = ref<any[]>([]);
const mockSelectedPath = ref<string | null>(null);
const mockFileContent = ref<any>(null);
const mockLoading = ref(false);
const mockError = ref<string | null>(null);

vi.mock('../composables/useFiles.js', () => ({
  useFiles: () => ({
    tree: mockTree,
    selectedPath: mockSelectedPath,
    fileContent: mockFileContent,
    loading: mockLoading,
    error: mockError,
    loadTree: mockLoadTree,
    loadFileContent: mockLoadFileContent,
    expandNode: mockExpandNode,
    writeFile: vi.fn(),
    selectPath: vi.fn(),
  }),
}));

vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue('<pre><code>highlighted</code></pre>'),
  }),
}));

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: FilesView }],
});

async function mountView() {
  const wrapper = mount(FilesView, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

describe('FilesView.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTree.value = [];
    mockSelectedPath.value = null;
    mockFileContent.value = null;
    mockLoading.value = false;
    mockError.value = null;
    mockLoadTree.mockResolvedValue([]);
    mockLoadFileContent.mockResolvedValue(undefined);
    mockExpandNode.mockResolvedValue([]);
  });

  it('1. calls loadTree on mount', async () => {
    await mountView();
    expect(mockLoadTree).toHaveBeenCalled();
  });

  it('2. renders file tree sidebar', async () => {
    const wrapper = await mountView();
    // Should have a sidebar with "Workspace Files" heading
    expect(wrapper.text()).toContain('Workspace Files');
  });

  it('3. shows empty state when no file is selected', async () => {
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('Select a file');
  });

  it('4. shows loading state when loading and tree is empty', async () => {
    mockLoading.value = true;
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('Loading');
  });

  it('5. shows error state when error is set and tree is empty', async () => {
    mockError.value = 'Connection failed';
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('Connection failed');
  });

  it('6. renders FileViewer when fileContent is set and not in edit mode', async () => {
    mockFileContent.value = {
      path: 'src/index.ts',
      content: 'const x = 1;',
      size: 13,
      modifiedAt: new Date().toISOString(),
    };
    const wrapper = await mountView();
    // FileViewer should show the file path
    expect(wrapper.text()).toContain('src/index.ts');
    // Edit button should be visible
    expect(wrapper.text()).toContain('Edit');
  });

  it('7. clicking Edit in viewer switches to editor', async () => {
    mockFileContent.value = {
      path: 'src/index.ts',
      content: 'const x = 1;',
      size: 13,
      modifiedAt: new Date().toISOString(),
    };
    const wrapper = await mountView();
    const editBtn = wrapper.findAll('button').find(b => b.text() === 'Edit');
    await editBtn!.trigger('click');
    // Now in editor mode — should show textarea
    const textarea = wrapper.find('textarea');
    expect(textarea.exists()).toBe(true);
  });

  it('8. editor cancelled event switches back to viewer', async () => {
    mockFileContent.value = {
      path: 'src/index.ts',
      content: 'const x = 1;',
      size: 13,
      modifiedAt: new Date().toISOString(),
    };
    const wrapper = await mountView();
    // Switch to edit mode
    const editBtn = wrapper.findAll('button').find(b => b.text() === 'Edit');
    await editBtn!.trigger('click');
    // Cancel — content unchanged so no confirm dialog
    const cancelBtn = wrapper.findAll('button').find(b => b.text().includes('Cancel'));
    await cancelBtn!.trigger('click');
    // Back to viewer — Edit button visible again
    await flushPromises();
    expect(wrapper.text()).toContain('Edit');
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it('9. selecting a file calls loadFileContent', async () => {
    mockTree.value = [{ name: 'index.ts', path: 'src/index.ts', type: 'file', size: 13 }];
    const wrapper = await mountView();
    // Simulate the select event from FileTree
    const fileTree = wrapper.findComponent({ name: 'FileTree' });
    if (fileTree.exists()) {
      await fileTree.vm.$emit('select', 'src/index.ts');
      expect(mockLoadFileContent).toHaveBeenCalledWith('src/index.ts');
    }
  });

  it('10. expanding a node calls expandNode', async () => {
    mockTree.value = [{ name: 'src', path: 'src', type: 'directory', children: null }];
    const wrapper = await mountView();
    const fileTree = wrapper.findComponent({ name: 'FileTree' });
    if (fileTree.exists()) {
      const node = mockTree.value[0];
      await fileTree.vm.$emit('expand', node);
      expect(mockExpandNode).toHaveBeenCalledWith(node);
    }
  });
});
