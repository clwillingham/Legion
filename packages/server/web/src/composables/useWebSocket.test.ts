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

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' });
  vi.resetModules();
});

async function fresh() {
  return (await import('./useWebSocket.js')).useWebSocket;
}

describe('useWebSocket', () => {
  it('returns connected state, connect, send, and onMessage', async () => {
    const useWebSocket = await fresh();
    const { connected, connect, send, onMessage } = useWebSocket();
    expect(connected.value).toBe(false);
    expect(typeof connect).toBe('function');
    expect(typeof send).toBe('function');
    expect(typeof onMessage).toBe('function');
  });

  it('sets connected to true on WebSocket open', async () => {
    const useWebSocket = await fresh();
    const { connected, connect } = useWebSocket();
    connect();
    lastCreatedWS.onopen!();
    expect(connected.value).toBe(true);
  });

  it('sends JSON data when connected', async () => {
    const useWebSocket = await fresh();
    const { connect, send } = useWebSocket();
    connect();
    lastCreatedWS.onopen!();
    send({ type: 'test', payload: 'hello' });
    expect(lastCreatedWS.sent).toHaveLength(1);
    expect(JSON.parse(lastCreatedWS.sent[0])).toEqual({ type: 'test', payload: 'hello' });
  });

  it('dispatches parsed messages to registered handlers', async () => {
    const useWebSocket = await fresh();
    const { connect, onMessage } = useWebSocket();
    connect();

    const handler = vi.fn();
    onMessage(handler);

    const msg = { type: 'message:sent', data: { content: 'hi' }, timestamp: '2025-01-01' };
    lastCreatedWS.onmessage!({ data: JSON.stringify(msg) });

    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('unsubscribe removes handler', async () => {
    const useWebSocket = await fresh();
    const { connect, onMessage } = useWebSocket();
    connect();

    const handler = vi.fn();
    const unsub = onMessage(handler);
    unsub();

    lastCreatedWS.onmessage!({ data: JSON.stringify({ type: 'test', data: {}, timestamp: '' }) });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores malformed messages', async () => {
    const useWebSocket = await fresh();
    const { connect, onMessage } = useWebSocket();
    connect();

    const handler = vi.fn();
    onMessage(handler);

    // Should not throw or call handler
    lastCreatedWS.onmessage!({ data: 'not json' });
    expect(handler).not.toHaveBeenCalled();
  });
});
