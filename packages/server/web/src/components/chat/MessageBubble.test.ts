import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MessageBubble from './MessageBubble.vue';
import type { Message } from '../../composables/useSession.js';

vi.mock('../../composables/useSession.js');

function userMessage(content: string): Message {
  return {
    role: 'user',
    participantId: 'user',
    content,
    timestamp: new Date().toISOString(),
  };
}

function assistantMessage(content: string, participantId = 'agent-1'): Message {
  return {
    role: 'assistant',
    participantId,
    content,
    timestamp: new Date().toISOString(),
  };
}

describe('MessageBubble', () => {
  it('renders user message content', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: userMessage('Hello!'), participantName: 'Web User' },
    });
    expect(wrapper.text()).toContain('Hello!');
    expect(wrapper.text()).toContain('Web User');
  });

  it('renders assistant message content', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: assistantMessage('Hi there'), participantName: 'Agent One' },
    });
    expect(wrapper.text()).toContain('Hi there');
    expect(wrapper.text()).toContain('Agent One');
  });

  it('aligns user messages to the right', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: userMessage('test') },
    });
    const outerDiv = wrapper.find('.flex');
    expect(outerDiv.classes()).toContain('justify-end');
  });

  it('aligns assistant messages to the left', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: assistantMessage('test') },
    });
    const outerDiv = wrapper.find('.flex');
    expect(outerDiv.classes()).toContain('justify-start');
  });

  it('falls back to participantId when no participantName', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: assistantMessage('test', 'agent-xyz') },
    });
    expect(wrapper.text()).toContain('agent-xyz');
  });

  it('renders timestamp', () => {
    const msg = userMessage('test');
    msg.timestamp = '2025-06-15T14:30:00Z';
    const wrapper = mount(MessageBubble, {
      props: { message: msg },
    });
    // Should contain a time string (format varies by locale)
    const timeText = wrapper.find('.opacity-50').text();
    expect(timeText.length).toBeGreaterThan(0);
  });

  it('renders tool calls when present', () => {
    const msg = assistantMessage('Using tools');
    msg.toolCalls = [{ id: 'tc-1', tool: 'read_file', args: { path: '/tmp/test' } }];
    const wrapper = mount(MessageBubble, {
      props: { message: msg },
    });
    expect(wrapper.text()).toContain('read_file');
  });

  it('renders custom component for communicate tool call', () => {
    const msg = assistantMessage('Talking to agent');
    msg.toolCalls = [{ id: 'tc-1', tool: 'communicate', args: { participantId: 'agent-2', message: 'hi' } }];
    const wrapper = mount(MessageBubble, {
      props: { message: msg },
    });
    // Should render CommunicateCallBlock (shows '→ agent-2'), not generic ToolCallBlock
    expect(wrapper.text()).toContain('→ agent-2');
    // Should NOT use the generic ToolCallBlock (which would show just 'communicate' without the arrow)
    expect(wrapper.html()).not.toContain('tool-call-block');
  });

  it('renders generic ToolCallBlock for non-communicate tool call', () => {
    const msg = assistantMessage('Reading file');
    msg.toolCalls = [{ id: 'tc-1', tool: 'file_read', args: { path: '/tmp/test' } }];
    const wrapper = mount(MessageBubble, {
      props: { message: msg },
    });
    // Should render generic ToolCallBlock with tool name
    expect(wrapper.text()).toContain('file_read');
    expect(wrapper.text()).not.toContain('communicate-call-placeholder');
  });

  it('renders custom component for communicate tool result', () => {
    const msg: Message = {
      role: 'user',
      participantId: 'agent-1',
      content: '',
      timestamp: new Date().toISOString(),
      toolResults: [{
        toolCallId: 'tc-1',
        tool: 'communicate',
        status: 'success',
        result: JSON.stringify({ response: 'Done!', conversationRef: 'agent-1__agent-2' }),
      }],
    };
    const wrapper = mount(MessageBubble, {
      props: { message: msg },
    });
    expect(wrapper.text()).toContain('communicate-result-placeholder');
  });
});
