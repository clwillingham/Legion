import type { WebSocket } from '@fastify/websocket';
import type { Session, RuntimeContext } from '@legion-collective/core';
import type { WebRuntime } from '../runtime/WebRuntime.js';

/**
 * Client → Server message types.
 */
export type ClientMessage =
  | { type: 'send'; target: string; message: string; conversation?: string }
  | { type: 'approval:respond'; requestId: string; approved: boolean; reason?: string }
  | { type: 'user:response'; conversationId: string; message: string };

/**
 * Set up WebSocket message handlers for a connected client.
 */
export function setupWSHandlers(
  ws: WebSocket,
  getSession: () => Session | null,
  getContext: () => RuntimeContext,
  webRuntime: WebRuntime,
  getApprovalHandler: () => ((requestId: string, approved: boolean, reason?: string) => void) | null,
): void {
  ws.on('message', async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {
      case 'send': {
        const session = getSession();
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', error: 'No active session' }));
          return;
        }
        try {
          const result = await session.send(
            'user',
            msg.target,
            msg.message,
            msg.conversation,
            getContext(),
          );
          ws.send(JSON.stringify({ type: 'send:result', data: result }));
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: 'error', error }));
        }
        break;
      }

      case 'approval:respond': {
        const handler = getApprovalHandler();
        if (handler) {
          handler(msg.requestId, msg.approved, msg.reason);
        } else {
          ws.send(JSON.stringify({ type: 'error', error: 'No approval handler registered' }));
        }
        break;
      }

      case 'user:response': {
        webRuntime.receiveResponse(msg.conversationId, msg.message);
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${(msg as { type: string }).type}` }));
    }
  });
}
