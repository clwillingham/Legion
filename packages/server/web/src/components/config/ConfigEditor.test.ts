import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ConfigEditor from './ConfigEditor.vue';

const mockGet = vi.fn();
const mockPut = vi.fn();

vi.mock('../../composables/useApi.js', () => ({
  useApi: () => ({
    get: mockGet,
    post: vi.fn(),
    put: mockPut,
    del: vi.fn(),
  }),
}));

const defaultConfig = {
  defaultProvider: 'anthropic',
  defaultAgent: 'ur-agent',
  logLevel: 'info',
  limits: {
    maxIterations: 50,
    maxCommunicationDepth: 5,
    maxTurnsPerCommunication: 10,
  },
  authorization: {
    defaultPolicy: 'auto',
    toolPolicies: { file_write: 'requires_approval' },
  },
  processManagement: {
    shell: '/bin/sh',
    defaultTimeout: 30,
    maxOutputSize: 51200,
    maxConcurrentProcesses: 10,
    maxOutputLines: 10000,
    blocklist: ['rm -rf'],
  },
};

describe('ConfigEditor.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ ...defaultConfig });
  });

  it('1. fetches config on mount', async () => {
    mount(ConfigEditor);
    await flushPromises();
    expect(mockGet).toHaveBeenCalledWith('/config');
  });

  it('2. renders defaultProvider field with loaded value', async () => {
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    const providerInput = wrapper.find('input[placeholder*="anthropic"]');
    expect(providerInput.exists()).toBe(true);
    expect((providerInput.element as HTMLInputElement).value).toBe('anthropic');
  });

  it('3. renders defaultAgent field', async () => {
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    const agentInput = wrapper.find('input[placeholder*="ur-agent"]');
    expect(agentInput.exists()).toBe(true);
    expect((agentInput.element as HTMLInputElement).value).toBe('ur-agent');
  });

  it('4. renders logLevel select with correct value', async () => {
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    const selects = wrapper.findAll('select');
    const logSelect = selects[0]; // First select is logLevel
    expect((logSelect.element as HTMLSelectElement).value).toBe('info');
  });

  it('5. shows unsaved changes indicator when dirty', async () => {
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    const input = wrapper.find('input[placeholder*="anthropic"]');
    await input.setValue('openai');
    expect(wrapper.text()).toContain('Unsaved changes');
  });

  it('6. no dirty indicator when config is unchanged', async () => {
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    expect(wrapper.text()).not.toContain('Unsaved changes');
  });

  it('7. save calls PUT /config with updated data', async () => {
    mockPut.mockResolvedValueOnce({ ...defaultConfig, defaultProvider: 'openai' });
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    const input = wrapper.find('input[placeholder*="anthropic"]');
    await input.setValue('openai');
    const saveBtn = wrapper.findAll('button').find(b => b.text() === 'Save');
    await saveBtn!.trigger('click');
    await flushPromises();
    expect(mockPut).toHaveBeenCalledWith('/config', expect.objectContaining({
      defaultProvider: 'openai',
    }));
  });

  it('8. save shows success indicator after saving', async () => {
    mockPut.mockResolvedValueOnce({ ...defaultConfig });
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    const input = wrapper.find('input[placeholder*="anthropic"]');
    await input.setValue('openai');
    const saveBtn = wrapper.findAll('button').find(b => b.text() === 'Save');
    await saveBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Saved');
  });

  it('9. cancel restores original values', async () => {
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    const input = wrapper.find('input[placeholder*="anthropic"]');
    await input.setValue('openai');
    const cancelBtn = wrapper.findAll('button').find(b => b.text() === 'Cancel');
    await cancelBtn!.trigger('click');
    expect((input.element as HTMLInputElement).value).toBe('anthropic');
  });

  it('10. shows error banner when save fails', async () => {
    mockPut.mockRejectedValueOnce(new Error('Validation failed'));
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    const input = wrapper.find('input[placeholder*="anthropic"]');
    await input.setValue('bad-provider');
    const saveBtn = wrapper.findAll('button').find(b => b.text() === 'Save');
    await saveBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Validation failed');
  });

  it('11. renders tool policies section', async () => {
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    expect(wrapper.text()).toContain('Tool Policies');
  });

  it('12. can add a new tool policy row', async () => {
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    const addBtn = wrapper.findAll('button').find(b => b.text().includes('Add'));
    await addBtn!.trigger('click');
    // Should now have an extra input for tool name
    const policyInputs = wrapper.findAll('input[placeholder="tool_name"]');
    expect(policyInputs.length).toBeGreaterThan(0);
  });

  it('13. renders process management section', async () => {
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    expect(wrapper.text()).toContain('Process Management');
  });

  it('14. renders blocklist field with existing values', async () => {
    const wrapper = mount(ConfigEditor);
    await flushPromises();
    const blocklistInput = wrapper.find('input[placeholder*="rm -rf"]');
    expect(blocklistInput.exists()).toBe(true);
    expect((blocklistInput.element as HTMLInputElement).value).toContain('rm -rf');
  });
});
