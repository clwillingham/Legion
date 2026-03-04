import type { EventBus, LegionEvent } from '@legion-collective/core';
import type { WebSocketManager } from './WebSocketManager.js';

/**
 * WSMessage — envelope sent from server to connected WebSocket clients.
 */
export interface WSMessage {
  type: string;
  data: LegionEvent;
  timestamp: string;
}

/**
 * Set up the EventBus → WebSocket bridge.
 *
 * Subscribes to all core events and broadcasts them to connected WS clients
 * as JSON messages. Returns an unsubscribe function.
 */
export function setupEventBridge(eventBus: EventBus, wsManager: WebSocketManager): () => void {
  return eventBus.onAny((event: LegionEvent) => {
    const message: WSMessage = {
      type: event.type,
      data: event,
      timestamp: new Date().toISOString(),
    };
    wsManager.broadcast(JSON.stringify(message));
  });
}
