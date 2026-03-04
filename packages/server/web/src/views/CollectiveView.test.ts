import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CollectiveView from './CollectiveView.vue';
import type { Participant } from '../composables/useCollective.js';

// Mock the useCollective composable
const mockParticipants = {
  value: [] as Participant[],
};
const mockLoadParticipants = vi.fn();
const mockCreateAgent = vi.fn();
const mockUpdateParticipant = vi.fn();
const mockRetireParticipant = vi.fn();

vi.mock('../composables/useCollective.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    useCollective: () => ({
      participants: mockParticipants,
      loadParticipants: mockLoadParticipants,
      createAgent: mockCreateAgent,
      updateParticipant: mockUpdateParticipant,
      retireParticipant: mockRetireParticipant,
    }),
  };
});

// Mock useTools — prevent actual API calls from AgentForm/ToolPolicyEditor
vi.mock('../composables/useTools.js', () => ({
  useTools: () => ({
    list: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue({ status: 'error', error: 'not available' }),
  }),
}));

function makeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'agent-1',
    type: 'agent',
    name: 'Test Agent',
    description: 'A test agent',
    status: 'active',
    tools: { '*': { mode: 'auto' } },
    model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    systemPrompt: 'Be helpful',
    ...overrides,
  };
}

beforeEach(() => {
  mockParticipants.value = [];
  vi.clearAllMocks();
});

describe('CollectiveView', () => {
  it('renders the Collective heading', () => {
    const wrapper = mount(CollectiveView);
    expect(wrapper.text()).toContain('Collective');
  });

  it('calls loadParticipants on mount', () => {
    mount(CollectiveView);
    expect(mockLoadParticipants).toHaveBeenCalled();
  });

  it('shows New Agent button in list mode', () => {
    const wrapper = mount(CollectiveView);
    const btn = wrapper.findAll('button').find(b => b.text() === 'New Agent');
    expect(btn).toBeTruthy();
  });

  it('shows counts summary', () => {
    mockParticipants.value = [
      makeParticipant({ id: 'a1', type: 'agent', status: 'active' }),
      makeParticipant({ id: 'a2', type: 'agent', status: 'active' }),
      makeParticipant({ id: 'u1', type: 'user', status: 'active', tools: {}, model: undefined }),
    ];
    const wrapper = mount(CollectiveView);
    expect(wrapper.text()).toContain('2 agents');
    expect(wrapper.text()).toContain('1 user');
  });

  it('shows "No participants found" when list is empty', () => {
    mockParticipants.value = [];
    const wrapper = mount(CollectiveView);
    expect(wrapper.text()).toContain('No participants found');
  });

  it('renders participant cards', () => {
    mockParticipants.value = [
      makeParticipant({ id: 'a1', name: 'Alpha' }),
      makeParticipant({ id: 'a2', name: 'Beta' }),
    ];
    const wrapper = mount(CollectiveView);
    expect(wrapper.text()).toContain('Alpha');
    expect(wrapper.text()).toContain('Beta');
  });

  it('filters by type', async () => {
    mockParticipants.value = [
      makeParticipant({ id: 'a1', type: 'agent', name: 'Agent One' }),
      makeParticipant({ id: 'u1', type: 'user', name: 'User One', tools: {}, model: undefined }),
    ];
    const wrapper = mount(CollectiveView);

    const select = wrapper.find('select');
    await select.setValue('user');

    expect(wrapper.text()).toContain('User One');
    expect(wrapper.text()).not.toContain('Agent One');
  });

  it('hides retired participants by default', () => {
    mockParticipants.value = [
      makeParticipant({ id: 'a1', name: 'Active Agent', status: 'active' }),
      makeParticipant({ id: 'a2', name: 'Retired Agent', status: 'retired' }),
    ];
    const wrapper = mount(CollectiveView);
    expect(wrapper.text()).toContain('Active Agent');
    expect(wrapper.text()).not.toContain('Retired Agent');
  });

  it('shows retired participants when checkbox toggled', async () => {
    mockParticipants.value = [
      makeParticipant({ id: 'a1', name: 'Active Agent', status: 'active' }),
      makeParticipant({ id: 'a2', name: 'Retired Agent', status: 'retired' }),
    ];
    const wrapper = mount(CollectiveView);

    const checkbox = wrapper.find('input[type="checkbox"]');
    await checkbox.setValue(true);

    expect(wrapper.text()).toContain('Active Agent');
    expect(wrapper.text()).toContain('Retired Agent');
  });

  it('switches to create mode when New Agent clicked', async () => {
    const wrapper = mount(CollectiveView);
    const btn = wrapper.findAll('button').find(b => b.text() === 'New Agent')!;
    await btn.trigger('click');

    // Should show AgentForm with "Create Agent" heading
    expect(wrapper.text()).toContain('Create Agent');
    // New Agent button should be hidden
    expect(wrapper.findAll('button').find(b => b.text() === 'New Agent')).toBeFalsy();
  });

  it('shows retired count when there are retired participants', () => {
    mockParticipants.value = [
      makeParticipant({ id: 'a1', status: 'active' }),
      makeParticipant({ id: 'a2', status: 'retired' }),
    ];
    const wrapper = mount(CollectiveView);
    expect(wrapper.text()).toContain('1 retired');
  });

  it('shows filter controls in list mode', () => {
    const wrapper = mount(CollectiveView);
    expect(wrapper.find('select').exists()).toBe(true);
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true);
  });
});
