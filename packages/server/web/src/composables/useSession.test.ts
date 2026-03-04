import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock WebSocket — needs to be a real class so `new WebSocket()` works
let lastCreatedWS: MockWebSocket;

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

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' });
  vi.resetModules();
});

async function freshModules() {
  const ws = await import('./useWebSocket.js');
  const sess = await import('./useSession.js');
  return { useWebSocket: ws.useWebSocket, useSession: sess.useSession };
}

function simulateWSMessage(msg: object) {
  lastCreatedWS.onmessage!({ data: JSON.stringify(msg) });
}

describe('useSession', () => {
  it('registers WS handler only once across multiple useSession() calls', async () => {
    const { useWebSocket, useSession } = await freshModules();
    const { connect } = useWebSocket();
    connect();

    // Call useSession multiple times (like App.vue, TopBar, ChatPanel do)
    useSession();
    useSession();
    useSession();

    const { messages } = useSession();

    // Send a message:sent event — should only create ONE message entry
    simulateWSMessage({
      type: 'message:sent',
      data: {
        fromParticipantId: 'user',
        toParticipantId: 'agent-1',
        content: 'hello',
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });

    const msgs = messages.get('user__agent-1') ?? [];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hello');
    expect(msgs[0].role).toBe('user');
  });

  it('handles message:sent event — adds user message', async () => {
    const { useWebSocket, useSession } = await freshModules();
    const { connect } = useWebSocket();
    connect();

    const { messages } = useSession();

    simulateWSMessage({
      type: 'message:sent',
      data: {
        fromParticipantId: 'user',
        toParticipantId: 'agent-1',
        content: 'test message',
        timestamp: '2025-01-01T00:00:00Z',
      },
      timestamp: '2025-01-01T00:00:00Z',
    });

    const msgs = messages.get('user__agent-1')!;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      role: 'user',
      participantId: 'user',
      content: 'test message',
    });
  });

  it('handles send:result — adds agent response and clears agentWorking', async () => {
    const { useWebSocket, useSession } = await freshModules();
    const { connect } = useWebSocket();
    connect();
    lastCreatedWS.onopen!();

    const { messages, agentWorking, sendMessage, session } = useSession();

    // Set session so sendMessage proceeds
    session.value = { id: 's1', name: 'Test', createdAt: '', status: 'active' };
    sendMessage('agent-1', 'hi');

    // Now the server responds with send:result including the agent's response
    simulateWSMessage({
      type: 'send:result',
      data: {
        status: 'success',
        response: 'Hello! How can I help?',
      },
      timestamp: new Date().toISOString(),
    });

    const msgs = messages.get('user__agent-1') ?? [];
    const assistantMsgs = msgs.filter(m => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe('Hello! How can I help?');
    expect(assistantMsgs[0].participantId).toBe('agent-1');
    expect(agentWorking.value).toBe(false);
  });

  it('handles send:result without response — just clears agentWorking', async () => {
    const { useWebSocket, useSession } = await freshModules();
    const { connect } = useWebSocket();
    connect();

    const { messages, agentWorking } = useSession();
    agentWorking.value = true;

    simulateWSMessage({
      type: 'send:result',
      data: { status: 'error', error: 'Something went wrong' },
      timestamp: new Date().toISOString(),
    });

    expect(agentWorking.value).toBe(false);
    expect(messages.size).toBe(0);
  });

  it('handles error event — clears agentWorking', async () => {
    const { useWebSocket, useSession } = await freshModules();
    const { connect } = useWebSocket();
    connect();

    const { agentWorking } = useSession();
    agentWorking.value = true;

    simulateWSMessage({
      type: 'error',
      data: { error: 'session error' },
      timestamp: new Date().toISOString(),
    });

    expect(agentWorking.value).toBe(false);
  });

  it('handles tool:call and tool:result events', async () => {
    const { useWebSocket, useSession } = await freshModules();
    const { connect } = useWebSocket();
    connect();

    const { activeToolCall } = useSession();

    simulateWSMessage({
      type: 'tool:call',
      data: { participantId: 'agent-1', toolName: 'read_file' },
      timestamp: new Date().toISOString(),
    });

    expect(activeToolCall.value).toEqual({
      participantId: 'agent-1',
      toolName: 'read_file',
    });

    simulateWSMessage({
      type: 'tool:result',
      data: { participantId: 'agent-1', toolName: 'read_file' },
      timestamp: new Date().toISOString(),
    });

    expect(activeToolCall.value).toBeNull();
  });

  it('handles approval:requested and approval:resolved events', async () => {
    const { useWebSocket, useSession } = await freshModules();
    const { connect } = useWebSocket();
    connect();

    const { pendingApprovals } = useSession();

    simulateWSMessage({
      type: 'approval:requested',
      data: {
        requestId: 'req-1',
        participantId: 'agent-1',
        toolName: 'dangerous_tool',
        arguments: { path: '/etc/passwd' },
      },
      timestamp: new Date().toISOString(),
    });

    expect(pendingApprovals.value).toHaveLength(1);
    expect(pendingApprovals.value[0]).toMatchObject({
      requestId: 'req-1',
      toolName: 'dangerous_tool',
    });

    simulateWSMessage({
      type: 'approval:resolved',
      data: { requestId: 'req-1' },
      timestamp: new Date().toISOString(),
    });

    expect(pendingApprovals.value).toHaveLength(0);
  });

  it('sendMessage sends WS message and sets agentWorking', async () => {
    const { useWebSocket, useSession } = await freshModules();
    const { connect } = useWebSocket();
    connect();
    lastCreatedWS.onopen!();

    const { agentWorking, sendMessage, session } = useSession();

    session.value = { id: 'sess-1', name: 'Test', createdAt: '', status: 'active' };

    sendMessage('agent-1', 'hello');

    expect(agentWorking.value).toBe(true);
    expect(lastCreatedWS.sent.length).toBeGreaterThan(0);
    const sent = JSON.parse(lastCreatedWS.sent[lastCreatedWS.sent.length - 1]);
    expect(sent).toEqual({
      type: 'send',
      target: 'agent-1',
      message: 'hello',
    });
  });

  it('respondToApproval sends approval response via WS', async () => {
    const { useWebSocket, useSession } = await freshModules();
    const { connect } = useWebSocket();
    connect();
    lastCreatedWS.onopen!();

    const { respondToApproval } = useSession();

    respondToApproval('req-1', true, 'looks safe');

    const sent = JSON.parse(lastCreatedWS.sent[lastCreatedWS.sent.length - 1]);
    expect(sent).toEqual({
      type: 'approval:respond',
      requestId: 'req-1',
      approved: true,
      reason: 'looks safe',
    });
  });
});
