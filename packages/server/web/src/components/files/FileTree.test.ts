import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import FileTree from './FileTree.vue';
import type { TreeNode } from '../../composables/useFiles.js';

const makeFile = (name: string, path: string): TreeNode => ({ name, path, type: 'file', size: 100 });
const makeDir = (name: string, path: string, children?: TreeNode[] | null, expanded = false): TreeNode =>
  ({ name, path, type: 'directory', children, expanded });

describe('FileTree.vue', () => {
  it('1. renders file nodes with correct names', () => {
    const nodes = [makeFile('index.ts', 'src/index.ts'), makeFile('App.vue', 'src/App.vue')];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    expect(wrapper.text()).toContain('index.ts');
    expect(wrapper.text()).toContain('App.vue');
  });

  it('2. renders directory nodes with chevron icon', () => {
    const nodes = [makeDir('src', 'src', [])];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    expect(wrapper.text()).toContain('▶');
    expect(wrapper.text()).toContain('src');
  });

  it('3. clicking a file emits select with correct path', async () => {
    const nodes = [makeFile('index.ts', 'src/index.ts')];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    const fileRow = wrapper.find('[class*="cursor-pointer"]');
    await fileRow.trigger('click');
    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')![0]).toEqual(['src/index.ts']);
  });

  it('4. clicking an expanded directory toggles it collapsed', async () => {
    const nodes = [makeDir('src', 'src', [], true)];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    expect(wrapper.text()).toContain('▼');
    const dirRow = wrapper.find('[class*="cursor-pointer"]');
    await dirRow.trigger('click');
    // After click, should be collapsed
    expect(nodes[0].expanded).toBe(false);
  });

  it('5. clicking unexpanded dir with null children emits expand', async () => {
    const nodes = [makeDir('src', 'src', null, false)];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    const dirRow = wrapper.find('[class*="cursor-pointer"]');
    await dirRow.trigger('click');
    expect(wrapper.emitted('expand')).toBeTruthy();
  });

  it('6. selected path gets highlighted class', () => {
    const nodes = [makeFile('index.ts', 'src/index.ts')];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: 'src/index.ts' } });
    // The file row should have bg-gray-700 for selected
    const fileRow = wrapper.find('[class*="bg-gray-700"]');
    expect(fileRow.exists()).toBe(true);
  });

  it('7. non-selected file does not have highlight class', () => {
    const nodes = [makeFile('index.ts', 'src/index.ts')];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: 'other.ts' } });
    const highlighted = wrapper.findAll('[class*="bg-gray-700"]');
    expect(highlighted.length).toBe(0);
  });

  it('8. expanded directory shows children', () => {
    const child = makeFile('main.ts', 'src/main.ts');
    const nodes = [makeDir('src', 'src', [child], true)];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    expect(wrapper.text()).toContain('main.ts');
  });

  it('9. collapsed directory hides children', () => {
    const child = makeFile('main.ts', 'src/main.ts');
    const nodes = [makeDir('src', 'src', [child], false)];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    // Children should not be visible when not expanded
    // The child is rendered by a sub-FileTree which is v-if'd on expanded
    expect(wrapper.text()).not.toContain('main.ts');
  });

  it('10. empty nodes array renders without content rows', () => {
    const wrapper = mount(FileTree, { props: { nodes: [], selectedPath: null } });
    const rows = wrapper.findAll('[class*="cursor-pointer"]');
    expect(rows.length).toBe(0);
  });

  it('11. directory with null children and expanded=true shows loading indicator', () => {
    const nodes = [makeDir('src', 'src', null, true)];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    expect(wrapper.text()).toContain('...');
  });

  it('12. directory with empty children and expanded=true shows empty indicator', () => {
    const nodes = [makeDir('src', 'src', [], true)];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    expect(wrapper.text()).toContain('Empty');
  });

  it('13. .ts files get the 🔧 icon', () => {
    const nodes = [makeFile('index.ts', 'index.ts')];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    expect(wrapper.text()).toContain('🔧');
  });

  it('14. .md files get the 📝 icon', () => {
    const nodes = [makeFile('README.md', 'README.md')];
    const wrapper = mount(FileTree, { props: { nodes, selectedPath: null } });
    expect(wrapper.text()).toContain('📝');
  });
});
