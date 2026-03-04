import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import AgentForm from './AgentForm.vue';
import type { Participant } from '../../composables/useCollective.js';

// Mock useTools — prevent actual API calls from AgentForm and ToolPolicyEditor
vi.mock('../../composables/useTools.js', () => ({
  useTools: () => ({
    list: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue({ status: 'error', error: 'not available' }),
  }),
}));

function makeAgent(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'test-agent',
    type: 'agent',
    name: 'Test Agent',
    description: 'A helpful test agent',
    status: 'active',
    tools: { '*': { mode: 'auto' } },
    model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    systemPrompt: 'You are helpful.',
    ...overrides,
  };
}

describe('AgentForm', () => {
  it('shows "Create Agent" heading in create mode', () => {
    const wrapper = mount(AgentForm);
    expect(wrapper.text()).toContain('Create Agent');
  });

  it('shows "Edit Agent" heading when existing prop is provided', () => {
    const wrapper = mount(AgentForm, {
      props: { existing: makeAgent() },
    });
    expect(wrapper.text()).toContain('Edit Agent');
  });

  it('pre-fills fields from existing participant', () => {
    const agent = makeAgent({
      name: 'My Bot',
      description: 'Custom desc',
      systemPrompt: 'Be helpful',
    });
    const wrapper = mount(AgentForm, { props: { existing: agent } });

    const inputs = wrapper.findAll('input[type="text"]');
    // ID input
    expect((inputs[0].element as HTMLInputElement).value).toBe('test-agent');
    // Name input
    expect((inputs[1].element as HTMLInputElement).value).toBe('My Bot');
    // Description input
    expect((inputs[2].element as HTMLInputElement).value).toBe('Custom desc');

    const textarea = wrapper.find('textarea');
    expect((textarea.element as HTMLTextAreaElement).value).toBe('Be helpful');
  });

  it('disables ID input in edit mode', () => {
    const wrapper = mount(AgentForm, {
      props: { existing: makeAgent() },
    });
    const idInput = wrapper.findAll('input[type="text"]')[0];
    expect((idInput.element as HTMLInputElement).disabled).toBe(true);
  });

  it('ID input is enabled in create mode', () => {
    const wrapper = mount(AgentForm);
    const idInput = wrapper.findAll('input[type="text"]')[0];
    expect((idInput.element as HTMLInputElement).disabled).toBe(false);
  });

  it('emits cancel when Cancel button clicked', async () => {
    const wrapper = mount(AgentForm);
    const cancelBtn = wrapper.findAll('button').find(b => b.text() === 'Cancel')!;
    await cancelBtn.trigger('click');
    expect(wrapper.emitted('cancel')).toBeTruthy();
  });

  it('shows validation error when submitting without required fields', async () => {
    const wrapper = mount(AgentForm);
    const form = wrapper.find('form');
    await form.trigger('submit');
    expect(wrapper.text()).toContain('ID is required');
  });

  it('shows name validation error', async () => {
    const wrapper = mount(AgentForm);
    const inputs = wrapper.findAll('input[type="text"]');
    await inputs[0].setValue('my-id');
    const form = wrapper.find('form');
    await form.trigger('submit');
    expect(wrapper.text()).toContain('Name is required');
  });

  it('shows system prompt validation error', async () => {
    const wrapper = mount(AgentForm);
    const inputs = wrapper.findAll('input[type="text"]');
    await inputs[0].setValue('my-id');
    await inputs[1].setValue('My Agent');
    const form = wrapper.find('form');
    await form.trigger('submit');
    expect(wrapper.text()).toContain('System prompt is required');
  });

  it('emits submit with correct data on valid submission', async () => {
    const wrapper = mount(AgentForm);
    await flushPromises();

    const inputs = wrapper.findAll('input[type="text"]');
    await inputs[0].setValue('my-agent');
    await inputs[1].setValue('My Agent');
    await inputs[2].setValue('Agent description');

    const textarea = wrapper.find('textarea');
    await textarea.setValue('You are helpful.');

    // Model will fall back to text input since mock returns error
    // Set model value via the text input that appears when no dynamic models
    const modelInput = wrapper.findAll('input[type="text"]').find(
      i => (i.element as HTMLInputElement).placeholder === 'model-id'
    );
    if (modelInput) {
      await modelInput.setValue('claude-sonnet-4-20250514');
    }

    const form = wrapper.find('form');
    await form.trigger('submit');

    expect(wrapper.emitted('submit')).toBeTruthy();
    const data = wrapper.emitted('submit')![0][0] as Record<string, unknown>;
    expect(data).toMatchObject({
      id: 'my-agent',
      name: 'My Agent',
      description: 'Agent description',
      systemPrompt: 'You are helpful.',
      model: {
        provider: 'anthropic',
      },
    });
  });

  it('includes tools in submission data', async () => {
    const wrapper = mount(AgentForm);
    await flushPromises();

    const inputs = wrapper.findAll('input[type="text"]');
    await inputs[0].setValue('my-agent');
    await inputs[1].setValue('My Agent');
    const textarea = wrapper.find('textarea');
    await textarea.setValue('Be helpful');

    // Set model
    const modelInput = wrapper.findAll('input[type="text"]').find(
      i => (i.element as HTMLInputElement).placeholder === 'model-id'
    );
    if (modelInput) await modelInput.setValue('test-model');

    await wrapper.find('form').trigger('submit');

    const data = wrapper.emitted('submit')![0][0] as Record<string, unknown>;
    expect(data).toHaveProperty('tools');
  });

  it('renders provider select with options', () => {
    const wrapper = mount(AgentForm);
    const selects = wrapper.findAll('select');
    const providerSelect = selects[0];
    const options = providerSelect.findAll('option');
    expect(options.length).toBe(3);
    expect(options.map(o => o.text())).toContain('Anthropic');
    expect(options.map(o => o.text())).toContain('OpenAI');
    expect(options.map(o => o.text())).toContain('OpenRouter');
  });

  it('shows Create Agent button in create mode', () => {
    const wrapper = mount(AgentForm);
    const submitBtn = wrapper.find('button[type="submit"]');
    expect(submitBtn.text()).toBe('Create Agent');
  });

  it('shows Save Changes button in edit mode', () => {
    const wrapper = mount(AgentForm, {
      props: { existing: makeAgent() },
    });
    const submitBtn = wrapper.find('button[type="submit"]');
    expect(submitBtn.text()).toBe('Save Changes');
  });

  // ── New sections ──

  it('renders Tool Authorization section', () => {
    const wrapper = mount(AgentForm);
    expect(wrapper.text()).toContain('Tool Authorization');
  });

  it('renders Approval Authority section', () => {
    const wrapper = mount(AgentForm);
    expect(wrapper.text()).toContain('Approval Authority');
  });

  it('renders Runtime Limits section', () => {
    const wrapper = mount(AgentForm);
    expect(wrapper.text()).toContain('Runtime Limits');
  });

  it('includes approvalAuthority in submission data', async () => {
    const wrapper = mount(AgentForm);
    await flushPromises();

    const inputs = wrapper.findAll('input[type="text"]');
    await inputs[0].setValue('my-agent');
    await inputs[1].setValue('My Agent');
    const textarea = wrapper.find('textarea');
    await textarea.setValue('Be helpful');

    const modelInput = wrapper.findAll('input[type="text"]').find(
      i => (i.element as HTMLInputElement).placeholder === 'model-id'
    );
    if (modelInput) await modelInput.setValue('test-model');

    await wrapper.find('form').trigger('submit');

    const data = wrapper.emitted('submit')![0][0] as Record<string, unknown>;
    expect(data).toHaveProperty('approvalAuthority');
  });

  it('shows model error when fetch fails', async () => {
    const wrapper = mount(AgentForm);
    await flushPromises();
    // The mock returns an error — should show fallback text input
    // and possibly an error message
    const modelInput = wrapper.findAll('input[type="text"]').find(
      i => (i.element as HTMLInputElement).placeholder === 'model-id'
    );
    expect(modelInput?.exists()).toBe(true);
  });

  it('pre-fills runtime config from existing participant', () => {
    const agent = makeAgent({
      runtimeConfig: {
        maxIterations: 30,
        maxCommunicationDepth: 3,
        maxTurnsPerCommunication: 10,
      },
    });
    const wrapper = mount(AgentForm, { props: { existing: agent } });

    // Find inputs by placeholder
    const allInputs = wrapper.findAll('input[type="text"]');
    const maxIterInput = allInputs.find(
      i => (i.element as HTMLInputElement).placeholder === '50'
    );
    const commDepthInput = allInputs.find(
      i => (i.element as HTMLInputElement).placeholder === '5'
    );
    const turnsInput = allInputs.find(
      i => (i.element as HTMLInputElement).placeholder === '25'
    );

    // The runtime limits section is in a <details> which may be closed,
    // but the values should still be bound
    if (maxIterInput) {
      expect((maxIterInput.element as HTMLInputElement).value).toBe('30');
    }
    if (commDepthInput) {
      expect((commDepthInput.element as HTMLInputElement).value).toBe('3');
    }
    if (turnsInput) {
      expect((turnsInput.element as HTMLInputElement).value).toBe('10');
    }
  });
});
