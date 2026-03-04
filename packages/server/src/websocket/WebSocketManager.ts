import type { WebSocket } from '@fastify/websocket';

/**
 * WebSocketManager — tracks connected WebSocket clients and provides broadcast/send.
 */
export class WebSocketManager {
  private clients: Set<WebSocket> = new Set();

  add(client: WebSocket): void {
    this.clients.add(client);
    client.on('close', () => this.clients.delete(client));
  }

  remove(client: WebSocket): void {
    this.clients.delete(client);
  }

  broadcast(data: string): void {
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }

  hasConnectedClients(): boolean {
    return this.clients.size > 0;
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
