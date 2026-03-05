import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ConversationList from './ConversationList.vue';
import type { ConversationData, Message } from '../../composables/useSession.js';

const agents = [
  { id: 'agent-1', name: 'Alpha Agent' },
  { id: 'agent-2', name: 'Beta Agent' },
];

function makeConversation(overrides: Partial<ConversationData> = {}): ConversationData {
  return {
    sessionId: 'session-1',
    initiatorId: 'user',
    targetId: 'agent-1',
    messages: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ConversationList', () => {
  it('renders "Conversations" header', () => {
    const wrapper = mount(ConversationList, {
      props: {
        conversations: [],
        messages: new Map(),
        activeKey: null,
        agents,
      },
    });
    expect(wrapper.text()).toContain('Conversations');
  });

  it('shows empty state when no conversations exist', () => {
    const wrapper = mount(ConversationList, {
      props: {
        conversations: [],
        messages: new Map(),
        activeKey: null,
        agents,
      },
    });
    expect(wrapper.text()).toContain('No conversations yet');
  });

  it('renders conversation entries from conversation data', () => {
    const conversations = [
      makeConversation({ targetId: 'agent-1' }),
      makeConversation({ targetId: 'agent-2' }),
    ];
    const wrapper = mount(ConversationList, {
      props: {
        conversations,
        messages: new Map(),
        activeKey: null,
        agents,
      },
    });
    expect(wrapper.text()).toContain('Alpha Agent');
    expect(wrapper.text()).toContain('Beta Agent');
  });

  it('shows last message preview', () => {
    const msgs: Message[] = [
      { role: 'user', participantId: 'user', content: 'Hello there', timestamp: new Date().toISOString() },
    ];
    const conversations = [makeConversation({ targetId: 'agent-1', messages: msgs })];
    const wrapper = mount(ConversationList, {
      props: {
        conversations,
        messages: new Map([['user__agent-1', msgs]]),
        activeKey: null,
        agents,
      },
    });
    expect(wrapper.text()).toContain('Hello there');
  });

  it('highlights active conversation', () => {
    const conversations = [makeConversation({ targetId: 'agent-1' })];
    const wrapper = mount(ConversationList, {
      props: {
        conversations,
        messages: new Map(),
        activeKey: 'user__agent-1',
        agents,
      },
    });
    const buttons = wrapper.findAll('button');
    const activeBtn = buttons.find(b => b.text().includes('Alpha Agent'));
    expect(activeBtn?.classes()).toContain('bg-gray-800');
  });

  it('emits select when conversation is clicked', async () => {
    const conversations = [makeConversation({ targetId: 'agent-1' })];
    const wrapper = mount(ConversationList, {
      props: {
        conversations,
        messages: new Map(),
        activeKey: null,
        agents,
      },
    });
    const entryBtn = wrapper.findAll('button').find(b => b.text().includes('Alpha Agent'));
    await entryBtn?.trigger('click');

    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')![0][0]).toBe('user__agent-1');
  });

  it('shows "New conversation" for empty key', () => {
    const wrapper = mount(ConversationList, {
      props: {
        conversations: [],
        messages: new Map(),
        activeKey: 'user__agent-1',
        agents,
      },
    });
    expect(wrapper.text()).toContain('New conversation');
  });

  it('shows + button for new conversation', () => {
    const wrapper = mount(ConversationList, {
      props: {
        conversations: [],
        messages: new Map(),
        activeKey: null,
        agents,
      },
    });
    const plusBtn = wrapper.findAll('button').find(b => b.text().trim() === '+');
    expect(plusBtn?.exists()).toBe(true);
  });

  it('toggles agent picker on + click', async () => {
    const wrapper = mount(ConversationList, {
      props: {
        conversations: [],
        messages: new Map(),
        activeKey: null,
        agents,
      },
    });
    const plusBtn = wrapper.findAll('button').find(b => b.text().trim() === '+')!;
    await plusBtn.trigger('click');

    // Should show agent names in picker
    expect(wrapper.text()).toContain('Alpha Agent');
    expect(wrapper.text()).toContain('Beta Agent');
  });

  it('emits newConversation when agent is picked', async () => {
    const wrapper = mount(ConversationList, {
      props: {
        conversations: [],
        messages: new Map(),
        activeKey: null,
        agents,
      },
    });
    // Open picker
    const plusBtn = wrapper.findAll('button').find(b => b.text().trim() === '+')!;
    await plusBtn.trigger('click');

    // Click an agent
    const agentBtn = wrapper.findAll('button').find(b => b.text().includes('Alpha Agent'));
    await agentBtn?.trigger('click');

    expect(wrapper.emitted('newConversation')).toBeTruthy();
    expect(wrapper.emitted('newConversation')![0][0]).toBe('agent-1');
  });

  it('sorts conversations by most recent first', () => {
    const oldConv = makeConversation({
      targetId: 'agent-1',
      createdAt: '2024-01-01T00:00:00Z',
      messages: [{ role: 'user', participantId: 'user', content: 'Old', timestamp: '2024-01-01T00:00:00Z' }],
    });
    const newConv = makeConversation({
      targetId: 'agent-2',
      createdAt: '2024-06-01T00:00:00Z',
      messages: [{ role: 'user', participantId: 'user', content: 'New', timestamp: '2024-06-01T00:00:00Z' }],
    });

    const wrapper = mount(ConversationList, {
      props: {
        conversations: [oldConv, newConv],
        messages: new Map([
          ['user__agent-1', oldConv.messages],
          ['user__agent-2', newConv.messages],
        ]),
        activeKey: null,
        agents,
      },
    });

    // Beta Agent (newer) should appear before Alpha Agent (older)
    const text = wrapper.text();
    const betaIndex = text.indexOf('Beta Agent');
    const alphaIndex = text.indexOf('Alpha Agent');
    expect(betaIndex).toBeLessThan(alphaIndex);
  });
});
