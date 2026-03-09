import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import CommunicateCallBlock from './CommunicateCallBlock.vue';
import { useSession } from '../../composables/useSession.js';
import type { ToolCall, Message } from '../../composables/useSession.js';

vi.mock('../../composables/useSession.js');

const parentMessage: Message = {
  role: 'assistant',
  participantId: 'agent-1',
  content: '',
  timestamp: new Date().toISOString(),
};

const toolCall: ToolCall = {
  id: 'tc-1',
  tool: 'communicate',
  args: { participantId: 'agent-2', message: 'Hello agent 2' },
};

beforeEach(() => {
  const { messages } = useSession();
  messages.clear();
});

describe('CommunicateCallBlock', () => {
  it('renders header with target agent name', () => {
    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    expect(wrapper.text()).toContain('agent-2');
    expect(wrapper.text()).toContain('communicate');
  });

  it('derives conversationRef from parentMessage and toolCall args', () => {
    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    // The component should compute conversationRef as 'agent-1__agent-2'
    // and look for messages at that key
    expect(wrapper.html()).toContain('agent-1__agent-2');
  });

  it('renders nested messages when they exist in the messages Map', async () => {
    const { messages } = useSession();
    // Use an in-progress conversation (user message + assistant with pending tool calls)
    // so the component auto-expands on mount
    messages.set('agent-1__agent-2', [
      {
        role: 'user',
        participantId: 'agent-1',
        content: 'Hello agent 2',
        timestamp: new Date().toISOString(),
      },
      {
        role: 'assistant',
        participantId: 'agent-2',
        content: 'Hi agent 1!',
        timestamp: new Date().toISOString(),
        toolCalls: [{ id: 'tc-2', tool: 'file_read', args: {} }], // in-progress
      },
    ]);
    await nextTick();

    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    await nextTick();

    expect(wrapper.text()).toContain('Hello agent 2');
    expect(wrapper.text()).toContain('Hi agent 1!');
  });

  it('shows empty state when no nested messages exist yet', () => {
    const { messages } = useSession();
    messages.delete('agent-1__agent-2');

    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    // Should be collapsed or show waiting indicator
    expect(wrapper.text()).toContain('communicate');
  });

  it('auto-collapses when nested conversation completes', async () => {
    vi.useFakeTimers();
    const { messages } = useSession();

    // Start with an in-progress conversation (user message only)
    messages.set('agent-1__agent-2', [
      {
        role: 'user',
        participantId: 'agent-1',
        content: 'Hello agent 2',
        timestamp: new Date().toISOString(),
      },
    ]);

    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    await nextTick();

    // Should be expanded (auto-expand on messages appearing)
    expect(wrapper.find('.nested-conversation-feed').exists()).toBe(true);

    // Complete the conversation (assistant response with no tool calls)
    messages.get('agent-1__agent-2')!.push({
      role: 'assistant',
      participantId: 'agent-2',
      content: 'Done!',
      timestamp: new Date().toISOString(),
    });
    await nextTick();

    // Advance past the collapse delay
    vi.advanceTimersByTime(600);
    await nextTick();

    expect(wrapper.find('.nested-conversation-feed').exists()).toBe(false);

    vi.useRealTimers();
  });
});
