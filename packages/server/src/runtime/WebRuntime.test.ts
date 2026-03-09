import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebRuntime } from './WebRuntime.js';
import { WebSocketManager } from '../websocket/WebSocketManager.js';
import type { RuntimeContext } from '@legion-collective/core';

function createMockContext(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    participant: { id: 'user', type: 'user', name: 'User', description: '', tools: {}, approvalAuthority: {}, status: 'active', medium: { type: 'web' } },
    conversation: {
      data: { sessionId: 'test', initiatorId: 'agent-1', targetId: 'user', messages: [], createdAt: new Date().toISOString() },
    } as RuntimeContext['conversation'],
    session: {} as RuntimeContext['session'],
    communicationDepth: 0,
    toolRegistry: {} as RuntimeContext['toolRegistry'],
    config: {} as RuntimeContext['config'],
    eventBus: {} as RuntimeContext['eventBus'],
    storage: {} as RuntimeContext['storage'],
    workspaceRoot: '/test-workspace',
    authEngine: {} as RuntimeContext['authEngine'],
    pendingApprovalRegistry: {} as RuntimeContext['pendingApprovalRegistry'],
    ...overrides,
  };
}

describe('WebRuntime', () => {
  let wsManager: WebSocketManager;
  let runtime: WebRuntime;

  beforeEach(() => {
    wsManager = new WebSocketManager();
    runtime = new WebRuntime(wsManager, 1000);
  });

  it('should return error when no clients connected', async () => {
    const result = await runtime.handleMessage('hello', createMockContext());
    expect(result.status).toBe('error');
    expect(result.error).toContain('not connected');
  });

  it('should broadcast message and resolve on response', async () => {
    const mockWs = {
      readyState: 1,
      send: vi.fn(),
      on: vi.fn(),
    };
    wsManager.add(mockWs as never);

    const promise = runtime.handleMessage('hello from agent', createMockContext());

    // Simulate user response after a tick
    await new Promise(r => setTimeout(r, 10));
    runtime.receiveResponse('agent-1__user', 'hello back');

    const result = await promise;
    expect(result.status).toBe('success');
    expect(result.response).toBe('hello back');
  });

  it('should timeout if no response', async () => {
    const shortTimeout = new WebRuntime(wsManager, 50);
    const mockWs = {
      readyState: 1,
      send: vi.fn(),
      on: vi.fn(),
    };
    wsManager.add(mockWs as never);

    const result = await shortTimeout.handleMessage('hello', createMockContext());
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
  });
});
