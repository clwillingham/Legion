import { describe, it, expect, vi } from 'vitest';
import { WebSocketManager } from './WebSocketManager.js';

function createMockWs(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
    on: vi.fn(),
  };
}

describe('WebSocketManager', () => {
  it('should track connected clients', () => {
    const manager = new WebSocketManager();
    expect(manager.hasConnectedClients()).toBe(false);
    expect(manager.clientCount).toBe(0);

    const ws = createMockWs();
    manager.add(ws as never);
    expect(manager.hasConnectedClients()).toBe(true);
    expect(manager.clientCount).toBe(1);
  });

  it('should remove clients', () => {
    const manager = new WebSocketManager();
    const ws = createMockWs();
    manager.add(ws as never);
    manager.remove(ws as never);
    expect(manager.clientCount).toBe(0);
  });

  it('should broadcast to all connected clients', () => {
    const manager = new WebSocketManager();
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    manager.add(ws1 as never);
    manager.add(ws2 as never);

    manager.broadcast('hello');
    expect(ws1.send).toHaveBeenCalledWith('hello');
    expect(ws2.send).toHaveBeenCalledWith('hello');
  });

  it('should not send to clients with non-open readyState', () => {
    const manager = new WebSocketManager();
    const ws = createMockWs(3); // CLOSED
    manager.add(ws as never);

    manager.broadcast('hello');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('should auto-remove on close event', () => {
    const manager = new WebSocketManager();
    const ws = createMockWs();
    let closeHandler: () => void;
    ws.on.mockImplementation((event: string, handler: () => void) => {
      if (event === 'close') closeHandler = handler;
    });

    manager.add(ws as never);
    expect(manager.clientCount).toBe(1);

    closeHandler!();
    expect(manager.clientCount).toBe(0);
  });
});
