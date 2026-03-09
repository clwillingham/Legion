import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import CommunicateCallBlock from './CommunicateCallBlock.vue';
import { useSession } from '../../composables/useSession.js';
import type { ToolCall, Message } from '../../composables/useSession.js';

vi.mock('../../composables/useSession.js');

// Fixed timestamps so we can control the slicing behaviour
const CALL_TIME = '2026-01-01T10:00:00.000Z';
const BEFORE_CALL = '2026-01-01T09:59:00.000Z';
const AFTER_CALL = '2026-01-01T10:00:01.000Z';
const AFTER_CALL2 = '2026-01-01T10:00:02.000Z';

const parentMessage: Message = {
  role: 'assistant',
  participantId: 'agent-1',
  content: '',
  timestamp: CALL_TIME,
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

  it('renders only messages from this call (at or after parentMessage.timestamp)', async () => {
    const { messages } = useSession();
    // Simulate a previous call's messages (before CALL_TIME) plus this call's messages
    messages.set('agent-1__agent-2', [
      {
        role: 'user',
        participantId: 'agent-1',
        content: 'Old message from earlier call',
        timestamp: BEFORE_CALL,
      },
      {
        role: 'assistant',
        participantId: 'agent-2',
        content: 'Old reply',
        timestamp: BEFORE_CALL,
      },
      {
        role: 'user',
        participantId: 'agent-1',
        content: 'Hello agent 2',
        timestamp: AFTER_CALL,
      },
      {
        role: 'assistant',
        participantId: 'agent-2',
        content: 'Hi agent 1!',
        timestamp: AFTER_CALL2,
        toolCalls: [{ id: 'tc-2', tool: 'file_read', args: {} }], // in-progress
      },
    ]);

    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    await nextTick();

    // Only this call's messages should be visible
    expect(wrapper.text()).toContain('Hello agent 2');
    expect(wrapper.text()).toContain('Hi agent 1!');
    // Previous call's messages must not appear
    expect(wrapper.text()).not.toContain('Old message from earlier call');
    expect(wrapper.text()).not.toContain('Old reply');
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

    // Start with an in-progress conversation (user message only, timestamp within this call)
    messages.set('agent-1__agent-2', [
      {
        role: 'user',
        participantId: 'agent-1',
        content: 'Hello agent 2',
        timestamp: AFTER_CALL,
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
      timestamp: AFTER_CALL2,
    });
    await nextTick();

    // Advance past the collapse delay
    vi.advanceTimersByTime(600);
    await nextTick();

    expect(wrapper.find('.nested-conversation-feed').exists()).toBe(false);

    vi.useRealTimers();
  });
});
