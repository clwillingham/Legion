import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

// Mock WebSocket globally before any Vue component imports
let lastCreatedWS: InstanceType<typeof MockWebSocket>;

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];

  constructor(_url: string) {
    lastCreatedWS = this;
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; }
}

// Stub before imports
vi.stubGlobal('WebSocket', MockWebSocket);
vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' });

import ChatPanel from './ChatPanel.vue';
import { useSession } from '../../composables/useSession.js';
import { useWebSocket } from '../../composables/useWebSocket.js';

// Connect WS once — the composables are singletons
beforeAll(() => {
  useWebSocket().connect();
  lastCreatedWS.onopen!();
});

function simulateWSMessage(msg: object) {
  lastCreatedWS.onmessage!({ data: JSON.stringify(msg) });
}

describe('ChatPanel', () => {
  it('renders empty state when no messages', () => {
    const wrapper = mount(ChatPanel);
    expect(wrapper.text()).toContain('Send a message to start a conversation');
  });

  it('renders a user message when message:sent event arrives', async () => {
    const wrapper = mount(ChatPanel);

    simulateWSMessage({
      type: 'message:sent',
      data: {
        fromParticipantId: 'user',
        toParticipantId: 'ur-agent',
        content: 'Hello agent!',
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });

    await nextTick();

    expect(wrapper.text()).toContain('Hello agent!');
  });

  it('shows thinking indicator when agentWorking is true', async () => {
    const { agentWorking } = useSession();
    const wrapper = mount(ChatPanel);

    agentWorking.value = true;
    await nextTick();

    expect(wrapper.text()).toContain('Agent is thinking...');

    // Cleanup
    agentWorking.value = false;
  });

  it('shows tool call info when activeToolCall is set', async () => {
    const { agentWorking, activeToolCall } = useSession();
    const wrapper = mount(ChatPanel);

    agentWorking.value = true;
    activeToolCall.value = { participantId: 'agent-1', toolName: 'read_file' };
    await nextTick();

    expect(wrapper.text()).toContain('read_file');

    // Cleanup
    agentWorking.value = false;
    activeToolCall.value = null;
  });

  it('disables input when agent is working', async () => {
    const { agentWorking } = useSession();
    const wrapper = mount(ChatPanel);

    agentWorking.value = true;
    await nextTick();

    const textarea = wrapper.find('textarea');
    expect(textarea.attributes('disabled')).toBeDefined();

    // Cleanup
    agentWorking.value = false;
  });
});
