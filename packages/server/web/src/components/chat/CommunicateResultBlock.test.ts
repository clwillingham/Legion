import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CommunicateResultBlock from './CommunicateResultBlock.vue';
import type { ToolCallResult, Message } from '../../composables/useSession.js';

const parentMessage: Message = {
  role: 'user',
  participantId: 'agent-1',
  content: '',
  timestamp: new Date().toISOString(),
};

describe('CommunicateResultBlock', () => {
  it('displays the response text from a successful communicate result', () => {
    const toolResult: ToolCallResult = {
      toolCallId: 'tc-1',
      tool: 'communicate',
      status: 'success',
      result: JSON.stringify({ response: 'Task completed successfully', conversationRef: 'agent-1__agent-2' }),
    };
    const wrapper = mount(CommunicateResultBlock, {
      props: { toolResult, parentMessage },
    });
    expect(wrapper.text()).toContain('Task completed successfully');
  });

  it('shows error state for failed communicate result', () => {
    const toolResult: ToolCallResult = {
      toolCallId: 'tc-1',
      tool: 'communicate',
      status: 'error',
      result: 'Agent not found',
    };
    const wrapper = mount(CommunicateResultBlock, {
      props: { toolResult, parentMessage },
    });
    expect(wrapper.text()).toContain('Agent not found');
  });

  it('handles malformed JSON result gracefully', () => {
    const toolResult: ToolCallResult = {
      toolCallId: 'tc-1',
      tool: 'communicate',
      status: 'success',
      result: 'not valid json',
    };
    const wrapper = mount(CommunicateResultBlock, {
      props: { toolResult, parentMessage },
    });
    expect(wrapper.text()).toContain('not valid json');
  });

  it('shows success indicator for successful results', () => {
    const toolResult: ToolCallResult = {
      toolCallId: 'tc-1',
      tool: 'communicate',
      status: 'success',
      result: JSON.stringify({ response: 'Done', conversationRef: 'a__b' }),
    };
    const wrapper = mount(CommunicateResultBlock, {
      props: { toolResult, parentMessage },
    });
    // Should have green/success styling indicator
    expect(wrapper.find('.text-green-400').exists()).toBe(true);
  });
});
