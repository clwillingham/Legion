import type { EventMap, LegionEvent } from './events.js';

/**
 * EventHandler — typed callback for a specific event type.
 */
export type EventHandler<T extends LegionEvent> = (event: T) => void;

/**
 * EventBus — typed pub/sub event system.
 *
 * Used to decouple the core engine from the CLI/UI display layer.
 * The core fires events; the CLI/UI subscribes and renders them.
 */
export class EventBus {
  private handlers: Map<string, Set<EventHandler<LegionEvent>>> = new Map();

  /**
   * Subscribe to a specific event type.
   */
  on<K extends keyof EventMap>(
    eventType: K,
    handler: EventHandler<EventMap[K]>,
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    const handlerSet = this.handlers.get(eventType)!;
    handlerSet.add(handler as EventHandler<LegionEvent>);

    // Return an unsubscribe function
    return () => {
      handlerSet.delete(handler as EventHandler<LegionEvent>);
    };
  }

  /**
   * Subscribe to all events.
   */
  onAny(handler: EventHandler<LegionEvent>): () => void {
    if (!this.handlers.has('*')) {
      this.handlers.set('*', new Set());
    }

    const handlerSet = this.handlers.get('*')!;
    handlerSet.add(handler);

    return () => {
      handlerSet.delete(handler);
    };
  }

  /**
   * Emit an event to all subscribers.
   */
  emit<K extends keyof EventMap>(event: EventMap[K]): void {
    // Notify specific handlers
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }

    // Notify wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(event);
      }
    }
  }

  /**
   * Remove all handlers for a specific event type (or all events).
   */
  clear(eventType?: keyof EventMap): void {
    if (eventType) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.clear();
    }
  }
}
