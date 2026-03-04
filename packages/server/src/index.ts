export { LegionServer, type ServerOptions } from './server.js';
export { WebRuntime } from './runtime/WebRuntime.js';
export { WebSocketManager } from './websocket/WebSocketManager.js';
export { setupEventBridge } from './websocket/bridge.js';
export type { WSMessage } from './websocket/bridge.js';

import type { ServerOptions } from './server.js';
import { LegionServer } from './server.js';

/**
 * Create a Legion web server.
 */
export function createServer(options: ServerOptions): LegionServer {
  return new LegionServer(options);
}
