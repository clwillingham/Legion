import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FileViewer from './FileViewer.vue';

// Mock shiki to avoid dynamic import issues in test environment
vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue('<pre><code>highlighted</code></pre>'),
  }),
}));

const defaultProps = {
  filePath: 'src/index.ts',
  content: 'const x = 1;',
  size: 13,
  modifiedAt: '2024-01-15T10:30:00.000Z',
};

describe('FileViewer.vue', () => {
  it('1. renders file path in toolbar', () => {
    const wrapper = mount(FileViewer, { props: defaultProps });
    expect(wrapper.text()).toContain('src/index.ts');
  });

  it('2. renders formatted byte size in toolbar', () => {
    const wrapper = mount(FileViewer, { props: { ...defaultProps, size: 13 } });
    expect(wrapper.text()).toContain('13 B');
  });

  it('3. renders KB for sizes >= 1024 bytes', () => {
    const wrapper = mount(FileViewer, { props: { ...defaultProps, size: 2048 } });
    expect(wrapper.text()).toContain('KB');
  });

  it('4. renders a date string in toolbar', () => {
    const wrapper = mount(FileViewer, { props: defaultProps });
    // Should render some date representation
    expect(wrapper.text()).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|Jan|Feb|Mar/);
  });

  it('5. shows fallback <pre> element for content', () => {
    const wrapper = mount(FileViewer, { props: defaultProps });
    // Should have pre tag (either plain fallback or shiki-wrapped)
    expect(wrapper.html()).toContain('<pre');
  });

  it('6. renders Edit button', () => {
    const wrapper = mount(FileViewer, { props: defaultProps });
    const editBtn = wrapper.find('button');
    expect(editBtn.exists()).toBe(true);
    expect(editBtn.text()).toContain('Edit');
  });

  it('7. clicking Edit button emits edit event', async () => {
    const wrapper = mount(FileViewer, { props: defaultProps });
    const editBtn = wrapper.find('button');
    await editBtn.trigger('click');
    expect(wrapper.emitted('edit')).toBeTruthy();
  });

  it('8. content prop is displayed in fallback pre', () => {
    const wrapper = mount(FileViewer, { props: { ...defaultProps, filePath: 'file.unknown' } });
    expect(wrapper.html()).toContain('const x = 1;');
  });

  it('9. has a scrollable content container', () => {
    const wrapper = mount(FileViewer, { props: defaultProps });
    const scrollable = wrapper.find('[class*="overflow-auto"]');
    expect(scrollable.exists()).toBe(true);
  });

  it('10. component mounts without errors', () => {
    expect(() => mount(FileViewer, { props: defaultProps })).not.toThrow();
  });

  it('11. renders content for a different filePath', () => {
    const wrapper = mount(FileViewer, { props: { ...defaultProps, filePath: 'README.md', content: '# Hello' } });
    expect(wrapper.text()).toContain('README.md');
  });

  it('12. formats large file size in MB', () => {
    const wrapper = mount(FileViewer, { props: { ...defaultProps, size: 2 * 1024 * 1024 } });
    expect(wrapper.text()).toContain('MB');
  });
});
