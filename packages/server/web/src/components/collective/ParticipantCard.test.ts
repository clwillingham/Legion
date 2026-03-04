import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ParticipantCard from './ParticipantCard.vue';
import type { Participant } from '../../composables/useCollective.js';

function makeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'agent-1',
    type: 'agent',
    name: 'Test Agent',
    description: 'A helpful test agent',
    status: 'active',
    tools: { '*': { mode: 'auto' } },
    model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    systemPrompt: 'You are a test agent.',
    ...overrides,
  };
}

describe('ParticipantCard', () => {
  it('renders participant name and status', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant() },
    });
    expect(wrapper.text()).toContain('Test Agent');
    expect(wrapper.text()).toContain('active');
  });

  it('renders participant ID and type badge', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant() },
    });
    expect(wrapper.text()).toContain('agent-1');
    expect(wrapper.text()).toContain('agent');
  });

  it('renders description', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant({ description: 'My custom description' }) },
    });
    expect(wrapper.text()).toContain('My custom description');
  });

  it('shows model info for agents', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant() },
    });
    expect(wrapper.text()).toContain('anthropic/claude-sonnet-4-20250514');
  });

  it('shows tool summary with wildcard', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant({ tools: { '*': { mode: 'auto' } } }) },
    });
    expect(wrapper.text()).toContain('All tools');
  });

  it('shows tool count when many tools', () => {
    const wrapper = mount(ParticipantCard, {
      props: {
        participant: makeParticipant({
          tools: {
            read_file: { mode: 'auto' },
            write_file: { mode: 'auto' },
            execute: { mode: 'requires_approval' },
            search: { mode: 'auto' },
          },
        }),
      },
    });
    expect(wrapper.text()).toContain('4 tools');
  });

  it('lists tool names when 3 or fewer', () => {
    const wrapper = mount(ParticipantCard, {
      props: {
        participant: makeParticipant({
          tools: {
            read_file: { mode: 'auto' },
            search: { mode: 'auto' },
          },
        }),
      },
    });
    expect(wrapper.text()).toContain('read_file');
    expect(wrapper.text()).toContain('search');
  });

  it('shows "No tools" when tools is empty', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant({ tools: {} }) },
    });
    expect(wrapper.text()).toContain('No tools');
  });

  it('shows edit and retire buttons for active agents', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant() },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons.some(b => b.text() === 'Edit')).toBe(true);
    expect(buttons.some(b => b.text() === 'Retire')).toBe(true);
  });

  it('hides action buttons for retired agents', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant({ status: 'retired' }) },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons.some(b => b.text() === 'Edit')).toBe(false);
    expect(buttons.some(b => b.text() === 'Retire')).toBe(false);
  });

  it('hides action buttons for user participants', () => {
    const wrapper = mount(ParticipantCard, {
      props: {
        participant: makeParticipant({
          type: 'user',
          tools: {},
          model: undefined,
          systemPrompt: undefined,
        }),
      },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons.some(b => b.text() === 'Edit')).toBe(false);
  });

  it('emits edit with participant when Edit clicked', async () => {
    const p = makeParticipant();
    const wrapper = mount(ParticipantCard, { props: { participant: p } });
    const editBtn = wrapper.findAll('button').find(b => b.text() === 'Edit')!;
    await editBtn.trigger('click');
    expect(wrapper.emitted('edit')).toBeTruthy();
    expect(wrapper.emitted('edit')![0]).toEqual([p]);
  });

  it('emits retire with participant ID when Retire clicked', async () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant({ id: 'agent-x' }) },
    });
    const retireBtn = wrapper.findAll('button').find(b => b.text() === 'Retire')!;
    await retireBtn.trigger('click');
    expect(wrapper.emitted('retire')).toBeTruthy();
    expect(wrapper.emitted('retire')![0]).toEqual(['agent-x']);
  });

  it('applies opacity class for retired participants', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant({ status: 'retired' }) },
    });
    expect(wrapper.find('.opacity-60').exists()).toBe(true);
  });

  it('shows red status badge for retired', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant({ status: 'retired' }) },
    });
    const badge = wrapper.find('.bg-red-900');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('retired');
  });

  it('shows green status badge for active', () => {
    const wrapper = mount(ParticipantCard, {
      props: { participant: makeParticipant({ status: 'active' }) },
    });
    const badge = wrapper.find('.bg-green-900');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('active');
  });

  it('shows medium info for user participants', () => {
    const wrapper = mount(ParticipantCard, {
      props: {
        participant: makeParticipant({
          type: 'user',
          tools: {},
          model: undefined,
          medium: { type: 'cli' },
        }),
      },
    });
    expect(wrapper.text()).toContain('cli');
  });
});
