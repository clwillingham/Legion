import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import FileEditor from './FileEditor.vue';

const mockExecute = vi.fn();

vi.mock('../../composables/useTools.js', () => ({
  useTools: () => ({
    execute: mockExecute,
    list: vi.fn(),
  }),
}));

// Mock window.confirm
const confirmMock = vi.fn();
Object.defineProperty(window, 'confirm', { value: confirmMock, writable: true });

const defaultProps = {
  filePath: 'src/index.ts',
  initialContent: 'const x = 1;',
};

describe('FileEditor.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockReturnValue(true);
  });

  it('1. renders textarea with initial content', () => {
    const wrapper = mount(FileEditor, { props: defaultProps });
    const textarea = wrapper.find('textarea');
    expect(textarea.exists()).toBe(true);
    expect(textarea.element.value).toBe('const x = 1;');
  });

  it('2. shows file path in toolbar', () => {
    const wrapper = mount(FileEditor, { props: defaultProps });
    expect(wrapper.text()).toContain('src/index.ts');
  });

  it('3. initially no dirty indicator when content is unchanged', () => {
    const wrapper = mount(FileEditor, { props: defaultProps });
    expect(wrapper.text()).not.toContain('Unsaved changes');
  });

  it('4. shows dirty indicator after modifying textarea', async () => {
    const wrapper = mount(FileEditor, { props: defaultProps });
    const textarea = wrapper.find('textarea');
    await textarea.setValue('const x = 2;');
    expect(wrapper.text()).toContain('Unsaved changes');
  });

  it('5. cancel with no changes emits cancelled without calling confirm', async () => {
    const wrapper = mount(FileEditor, { props: defaultProps });
    const cancelBtn = wrapper.findAll('button').find(b => b.text().includes('Cancel'));
    await cancelBtn!.trigger('click');
    expect(confirmMock).not.toHaveBeenCalled();
    expect(wrapper.emitted('cancelled')).toBeTruthy();
  });

  it('6. cancel with dirty changes calls confirm before emitting', async () => {
    const wrapper = mount(FileEditor, { props: defaultProps });
    const textarea = wrapper.find('textarea');
    await textarea.setValue('changed content');
    const cancelBtn = wrapper.findAll('button').find(b => b.text().includes('Cancel'));
    await cancelBtn!.trigger('click');
    expect(confirmMock).toHaveBeenCalled();
    expect(wrapper.emitted('cancelled')).toBeTruthy();
  });

  it('7. cancel with dirty content and confirm=false does not emit cancelled', async () => {
    confirmMock.mockReturnValueOnce(false);
    const wrapper = mount(FileEditor, { props: defaultProps });
    const textarea = wrapper.find('textarea');
    await textarea.setValue('changed content');
    const cancelBtn = wrapper.findAll('button').find(b => b.text().includes('Cancel'));
    await cancelBtn!.trigger('click');
    expect(wrapper.emitted('cancelled')).toBeFalsy();
  });

  it('8. save calls tools.execute with correct args', async () => {
    mockExecute.mockResolvedValueOnce({ status: 'success' });
    const wrapper = mount(FileEditor, { props: defaultProps });
    const textarea = wrapper.find('textarea');
    await textarea.setValue('new content');
    const saveBtn = wrapper.findAll('button').find(b => b.text() === 'Save');
    await saveBtn!.trigger('click');
    await flushPromises();
    expect(mockExecute).toHaveBeenCalledWith('file_write', {
      path: 'src/index.ts',
      content: 'new content',
    });
  });

  it('9. success result emits saved with new content', async () => {
    mockExecute.mockResolvedValueOnce({ status: 'success' });
    const wrapper = mount(FileEditor, { props: defaultProps });
    const textarea = wrapper.find('textarea');
    await textarea.setValue('new content');
    const saveBtn = wrapper.findAll('button').find(b => b.text() === 'Save');
    await saveBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('saved')).toBeTruthy();
    expect(wrapper.emitted('saved')![0]).toEqual(['new content']);
  });

  it('10. error result shows error message', async () => {
    mockExecute.mockResolvedValueOnce({ status: 'error', error: 'Permission denied' });
    const wrapper = mount(FileEditor, { props: defaultProps });
    const textarea = wrapper.find('textarea');
    await textarea.setValue('new content');
    const saveBtn = wrapper.findAll('button').find(b => b.text() === 'Save');
    await saveBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Permission denied');
  });

  it('11. approval_required shows pending-approval state', async () => {
    mockExecute.mockResolvedValueOnce({ status: 'approval_required' });
    const wrapper = mount(FileEditor, { props: defaultProps });
    const textarea = wrapper.find('textarea');
    await textarea.setValue('new content');
    const saveBtn = wrapper.findAll('button').find(b => b.text() === 'Save');
    await saveBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Awaiting approval');
  });

  it('12. rejected result shows rejected state', async () => {
    mockExecute.mockResolvedValueOnce({ status: 'rejected' });
    const wrapper = mount(FileEditor, { props: defaultProps });
    const textarea = wrapper.find('textarea');
    await textarea.setValue('new content');
    const saveBtn = wrapper.findAll('button').find(b => b.text() === 'Save');
    await saveBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('rejected');
  });

  it('13. save button is disabled when content is unchanged', () => {
    const wrapper = mount(FileEditor, { props: defaultProps });
    const saveBtn = wrapper.findAll('button').find(b => b.text() === 'Save');
    expect(saveBtn!.attributes('disabled')).toBeDefined();
  });

  it('14. Ctrl+S triggers save', async () => {
    mockExecute.mockResolvedValueOnce({ status: 'success' });
    const wrapper = mount(FileEditor, { props: defaultProps });
    const textarea = wrapper.find('textarea');
    await textarea.setValue('new content');
    await textarea.trigger('keydown', { ctrlKey: true, key: 's' });
    await flushPromises();
    expect(mockExecute).toHaveBeenCalledWith('file_write', expect.any(Object));
  });
});
