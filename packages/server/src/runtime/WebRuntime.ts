import {
  ParticipantRuntime,
  type RuntimeContext,
  type RuntimeResult,
} from '@legion-collective/core';
import type { WebSocketManager } from '../websocket/WebSocketManager.js';

/**
 * WebRuntime — ParticipantRuntime for browser-connected users.
 *
 * Symmetric with REPLRuntime: when an agent sends a message to a user,
 * WebRuntime pushes the message to the browser via WebSocket and waits
 * for the user's response via the same WS connection.
 */
export class WebRuntime extends ParticipantRuntime {
  private wsManager: WebSocketManager;
  private pendingResponses: Map<string, {
    resolve: (response: string) => void;
    reject: (error: Error) => void;
  }> = new Map();

  /** Response timeout in ms (default 5 minutes). */
  private timeoutMs: number;

  constructor(wsManager: WebSocketManager, timeoutMs: number = 5 * 60 * 1000) {
    super();
    this.wsManager = wsManager;
    this.timeoutMs = timeoutMs;
  }

  async handleMessage(message: string, context: RuntimeContext): Promise<RuntimeResult> {
    if (!this.wsManager.hasConnectedClients()) {
      return {
        status: 'error',
        error: 'User is not connected — no active web session. '
             + 'The user must have the web interface open to receive messages. '
             + 'Try again later or use a different approach.',
      };
    }

    const conversationId = `${context.conversation.data.initiatorId}__${context.conversation.data.targetId}`;

    this.wsManager.broadcast(JSON.stringify({
      type: 'agent:message',
      data: {
        conversationId,
        fromParticipantId: context.conversation.data.initiatorId,
        message,
      },
      timestamp: new Date().toISOString(),
    }));

    try {
      const response = await this.waitForResponse(conversationId);
      return { status: 'success', response };
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Wait for the user to respond via WebSocket.
   */
  private waitForResponse(conversationId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(conversationId);
        reject(new Error('User response timed out'));
      }, this.timeoutMs);

      this.pendingResponses.set(conversationId, {
        resolve: (msg) => { clearTimeout(timeout); resolve(msg); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });
    });
  }

  /**
   * Called by the WebSocket handler when a user:response message arrives.
   */
  receiveResponse(conversationId: string, message: string): void {
    const pending = this.pendingResponses.get(conversationId);
    if (pending) {
      this.pendingResponses.delete(conversationId);
      pending.resolve(message);
    }
  }
}
