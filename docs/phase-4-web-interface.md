# Phase 4: Web Interface — Design Document

**Created**: March 3, 2026
**Status**: Milestones 4.1, 4.2, 4.3, 4.4, and 4.5 complete

---

## Overview

Phase 4 adds a web-based interface to Legion as an alternative to the REPL. The web UI is a Vue 3 SPA served by a Fastify HTTP + WebSocket server in a new `packages/server` package. It does **not** replace the CLI — both interfaces can coexist, though not simultaneously on the same session.

---

## Architecture

### Package Structure

```
packages/server/                     # @legion-collective/server
├── package.json
├── tsconfig.json
├── tsup.config.ts                   # ESM, external deps
├── src/
│   ├── index.ts                     # Public API: createServer(), ServerOptions
│   ├── server.ts                    # Fastify instance setup, plugin registration
│   ├── routes/
│   │   ├── collective.ts            # GET/POST/PUT /api/collective/||participants
│   │   ├── sessions.ts             # GET/POST /api/sessions, POST /:id/activate, GET /:id/*
│   │   ├── messages.ts             # GET /api/conversations/:id/messages, POST /api/sessions/:id/send
│   │   ├── approvals.ts            # POST /api/approvals/:id/respond
│   │   ├── processes.ts            # GET/POST /api/processes, POST /api/processes/:id/stop
│   │   ├── files.ts                # GET /api/files (tree), GET/PUT /api/files/* (content)
│   │   ├── config.ts               # GET/PUT /api/config (workspace config only)
│   │   └── tools.ts                # GET /api/tools, POST /api/tools/:name/execute
│   ├── websocket/
│   │   ├── bridge.ts               # EventBus → WebSocket broadcast
│   │   └── handlers.ts             # WS message handlers (user input, approval responses)
│   └── runtime/
│       └── WebRuntime.ts           # ParticipantRuntime for browser users
├── web/                             # Vue 3 SPA
│   ├── package.json                 # Vue/Vite/Tailwind deps (separate from server)
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── router/
│   │   │   └── index.ts
│   │   ├── composables/
│   │   │   ├── useWebSocket.ts      # WS connect/reconnect/message handling
│   │   │   ├── useApi.ts            # REST API client
│   │   │   ├── useSession.ts        # Session + conversation + message state
│   │   │   ├── useCollective.ts     # Participants state + CRUD
│   │   │   ├── useTools.ts          # Tool execution gateway (list + execute via ToolRegistry)
│   │   │   └── useProcesses.ts      # Process state + output buffers
│   │   ├── components/
│   │   │   ├── chat/
│   │   │   │   ├── ChatPanel.vue           # Two-column: ConversationList + messages
│   │   │   │   ├── ConversationList.vue    # Conversation sidebar with agent picker
│   │   │   │   ├── MessageBubble.vue
│   │   │   │   ├── MessageInput.vue
│   │   │   │   ├── ToolCallBlock.vue
│   │   │   │   └── ApprovalCard.vue
│   │   │   ├── collective/
│   │   │   │   ├── ParticipantCard.vue
│   │   │   │   ├── AgentForm.vue
│   │   │   │   ├── ToolPolicyEditor.vue     # Granular per-tool auth config
│   │   │   │   └── ApprovalAuthorityEditor.vue  # Per-participant approval config
│   │   │   ├── sessions/
│   │   │   │   ├── SessionList.vue
│   │   │   │   └── SessionDashboard.vue
│   │   │   ├── processes/
│   │   │   │   ├── ProcessList.vue
│   │   │   │   └── ProcessOutput.vue
│   │   │   ├── files/
│   │   │   │   ├── FileTree.vue
│   │   │   │   ├── FileViewer.vue
│   │   │   │   └── FileEditor.vue
│   │   │   ├── config/
│   │   │   │   └── ConfigEditor.vue
│   │   │   └── layout/
│   │   │       ├── AppLayout.vue
│   │   │       ├── Sidebar.vue
│   │   │       └── TopBar.vue
│   │   ├── utils/
│   │   │   └── tool-categories.ts   # Known tool names, categories, default modes
│   │   └── views/
│   │       ├── ChatView.vue
│   │       ├── CollectiveView.vue
│   │       ├── SessionsView.vue
│   │       ├── ProcessesView.vue
│   │       ├── FilesView.vue
│   │       └── ConfigView.vue
│   └── dist/                        # Built output, served by Fastify
└── README.md
```

### Dependency Graph

```
@legion-collective/cli
  ├── @legion-collective/core
  └── @legion-collective/server      (optionalDependencies — for `legion serve` command)
        └── @legion-collective/core

@legion-collective/server
  ├── @legion-collective/core        (Session, EventBus, Collective, etc.)
  ├── fastify
  ├── @fastify/websocket
  └── @fastify/static               (serves web/dist/)
```

The server package has **no dependency on CLI**. CLI lists server as `optionalDependencies` and uses a dynamic `import()` in the serve command — if server isn't installed, a clear error is shown. In the monorepo both packages are always present, so this is purely a published-package concern. The Vue SPA is a nested project within server — its build output (`web/dist/`) is served as static files.

### Build Strategy

```bash
# From monorepo root:
npm run build           # tsc (core) + tsup (cli) + tsup (server) + vite build (web)

# Or individually:
cd packages/server && npm run build        # tsup for server TS
cd packages/server/web && npm run build    # vite for Vue SPA
```

The server's tsup config bundles the Fastify server code. The Vue SPA builds separately via Vite into `web/dist/`. At runtime, Fastify uses `@fastify/static` to serve `web/dist/` at the root path, and all `/api/*` routes are handled by Fastify route handlers.

---

## Server Layer (Milestone 4.1)

### `createServer()` Factory

The server package exports a single factory function:

```typescript
// packages/server/src/index.ts
export interface ServerOptions {
  workspace: Workspace;
  port?: number;              // default: 3000
  host?: string;              // default: '127.0.0.1' (local only)
}

export interface LegionServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number;
  readonly session: Session;
}

export function createServer(options: ServerOptions): LegionServer;
```

### Fastify Setup

```typescript
// packages/server/src/server.ts
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true });

  // Plugins
  await fastify.register(fastifyWebsocket);
  await fastify.register(fastifyStatic, {
    root: join(import.meta.dirname, '..', 'web', 'dist'),
    prefix: '/',
  });

  // API routes
  await fastify.register(collectiveRoutes, { prefix: '/api' });
  await fastify.register(sessionRoutes, { prefix: '/api' });
  await fastify.register(messageRoutes, { prefix: '/api' });
  await fastify.register(approvalRoutes, { prefix: '/api' });
  await fastify.register(processRoutes, { prefix: '/api' });
  await fastify.register(fileRoutes, { prefix: '/api' });
  await fastify.register(configRoutes, { prefix: '/api' });
  await fastify.register(toolRoutes, { prefix: '/api' });

  // WebSocket endpoint
  await fastify.register(websocketPlugin);

  return fastify;
}
```

### Server Initialization Flow

When `createServer()` is called, the server:

1. Initializes the `Workspace` (if not already initialized)
2. Creates a Fastify instance with plugins
3. Registers runtimes: `AgentRuntime` for `agent`, `MockRuntime` for `mock`, `WebRuntime` for `user:web`
4. Creates an `AuthEngine` with a web-based approval handler (delegates approvals to the browser via WebSocket)
5. Creates or resumes a `Session`
6. Sets up the EventBus → WebSocket bridge
7. Starts listening

```typescript
// Simplified flow inside createServer()
const workspace = options.workspace;
await workspace.initialize();

// Register runtimes
workspace.runtimeRegistry.register('agent', () => new AgentRuntime());
workspace.runtimeRegistry.register('mock', () => new MockRuntime());

const webRuntime = new WebRuntime(wsManager);
workspace.runtimeRegistry.register('user', () => webRuntime);
workspace.runtimeRegistry.register('user:web', () => webRuntime);

// Auth engine — approvals go to browser via WS
const authEngine = new AuthEngine({});
authEngine.setApprovalHandler(createWebApprovalHandler(wsManager));

// Session
const session = Session.create(
  sessionName,
  workspace.storage,
  workspace.runtimeRegistry,
  workspace.collective,
  workspace.eventBus,
);

// EventBus → WS bridge
setupEventBridge(workspace.eventBus, wsManager);
```

### CLI Integration

`@legion-collective/server` is listed as `optionalDependencies` in CLI's `package.json`. The serve command uses a dynamic import so the CLI works without it installed:

```typescript
// packages/cli/src/commands/serve.ts
import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { Workspace } from '@legion-collective/core';

export const serveCommand = new Command('serve')
  .description('Start the Legion web server')
  .option('-d, --dir <path>', 'Workspace directory', '.')
  .option('-p, --port <port>', 'Port number', '3000')
  .action(async (options) => {
    const root = resolve(options.dir);

    if (!await Workspace.isInitialized(root)) {
      console.log(chalk.red('✗ No Legion workspace found at'), chalk.dim(root));
      console.log(chalk.dim('  Run `legion init` first.'));
      return;
    }

    // Dynamic import — server package is optional
    let createServer: typeof import('@legion-collective/server').createServer;
    try {
      ({ createServer } = await import('@legion-collective/server'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
        console.log(chalk.red('✗ @legion-collective/server is not installed.'));
        console.log(chalk.dim('  Run: npm install @legion-collective/server'));
        return;
      }
      throw e;
    }

    const workspace = new Workspace(root);
    await workspace.initialize();

    const server = createServer({ workspace, port: parseInt(options.port, 10) });
    await server.start();
    console.log(chalk.green(`✓ Legion server running at http://localhost:${server.port}`));
  });
```

---

## REST API (Milestone 4.1)

### Collective Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/collective/participants` | List all participants (optional `?type=agent&status=active`) |
| `GET` | `/api/collective/participants/:id` | Get participant details |
| `POST` | `/api/collective/participants` | Create a new agent |
| `PUT` | `/api/collective/participants/:id` | Modify a participant |
| `DELETE` | `/api/collective/participants/:id` | Retire a participant |

### Session Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create a new session |
| `GET` | `/api/sessions/:id` | Get session details |
| `GET` | `/api/sessions/:id/conversations` | List conversations in session |
| `GET` | `/api/sessions/:id/conversations/:convId/messages` | Get messages (paginated) |
| `POST` | `/api/sessions/:id/send` | Send a message (`{ target, message, conversation? }`) |

### Approval Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/approvals/pending` | List pending approval requests |
| `POST` | `/api/approvals/:id/respond` | Approve/reject (`{ approved, reason? }`) |

### Process Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/processes` | List tracked processes |
| `GET` | `/api/processes/:id` | Get process status + recent output |
| `POST` | `/api/processes/:id/stop` | Stop a process |

### File Endpoints

File operations go through the core tool system for consistency and authorization.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/files/tree` | Get directory tree (calls `directory_list` tool) |
| `GET` | `/api/files/content?path=...` | Read file content (calls `file_read` tool) |
| `PUT` | `/api/files/content` | Write file content (calls `file_write` tool — goes through full auth flow) |
| `GET` | `/api/files/analyze?path=...` | Get file metadata (calls `file_analyze` tool) |

File reads and writes go through the tool system, which means they respect authorization policies. If the user's participant config has `file_write: requires_approval`, the PUT endpoint returns a 202 with an approval request instead of writing immediately.

### Config Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Get workspace configuration |
| `PUT` | `/api/config` | Update workspace configuration |

Only workspace configuration (`.legion/config.json`) is exposed. Global configuration (API keys) is deferred to Phase 6 when token auth + multi-user support are added.

### Tool Execution Gateway

Generic endpoints that expose the `ToolRegistry` to the web frontend. Rather than building individual REST endpoints for each data need (models, tools, etc.), the frontend can execute any registered tool as the user — staying within Legion's philosophy of tools as the universal interface.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tools` | List all registered tools (name, description, parameters) |
| `POST` | `/api/tools/:name/execute` | Execute a tool by name as the user (body = tool arguments) |

The execute endpoint creates a full `RuntimeContext` (with workspace, tool registry, and authorization) and runs the tool. This powers dynamic features like model listing (`list_models`), tool discovery (`list_tools`), and any future tools added to the registry — without needing new REST endpoints.

---

## WebSocket Protocol (Milestone 4.1)

### Connection

```
ws://localhost:3000/ws
```

Single WebSocket connection per browser tab. The server maintains a `WebSocketManager` that tracks connected clients.

### Server → Client Messages (EventBus Bridge)

All core events are forwarded to connected WS clients as JSON:

```typescript
// Message envelope
interface WSMessage {
  type: string;           // matches EventMap keys: 'message:sent', 'tool:call', etc.
  data: LegionEvent;      // the full event payload
  timestamp: string;      // ISO 8601
}
```

Events forwarded:
- `message:sent` / `message:received` — chat messages
- `tool:call` / `tool:result` — tool activity
- `approval:requested` / `approval:resolved` — approval flow
- `session:started` / `session:ended` — session lifecycle
- `iteration` — agent loop progress
- `process:*` — process events (started, output, completed, error)
- `error` — errors

### Client → Server Messages

```typescript
// User sends a chat message
{ type: 'send', target: string, message: string, conversation?: string }

// User responds to an approval request
{ type: 'approval:respond', requestId: string, approved: boolean, reason?: string }

// User responds to an agent-initiated message (WebRuntime)
{ type: 'user:response', conversationId: string, message: string }
```

### EventBus → WS Bridge

```typescript
// packages/server/src/websocket/bridge.ts
export function setupEventBridge(eventBus: EventBus, wsManager: WebSocketManager): void {
  eventBus.onAny((event) => {
    const message: WSMessage = {
      type: event.type,
      data: event,
      timestamp: new Date().toISOString(),
    };
    wsManager.broadcast(JSON.stringify(message));
  });
}
```

---

## WebRuntime (Milestone 4.1)

`WebRuntime` implements `ParticipantRuntime` for browser-connected users. It is the WebSocket equivalent of `REPLRuntime`.

```typescript
// packages/server/src/runtime/WebRuntime.ts
export class WebRuntime extends ParticipantRuntime {
  private wsManager: WebSocketManager;
  private pendingResponses: Map<string, {
    resolve: (response: string) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(wsManager: WebSocketManager) {
    super();
    this.wsManager = wsManager;
  }

  async handleMessage(message: string, context: RuntimeContext): Promise<RuntimeResult> {
    // Check if a browser is connected
    if (!this.wsManager.hasConnectedClients()) {
      return {
        status: 'error',
        error: 'User is not connected — no active web session. '
             + 'The user must have the web interface open to receive messages. '
             + 'Try again later or use a different approach.',
      };
    }

    // Push message to browser
    const conversationId = `${context.conversation.initiatorId}__${context.conversation.targetId}`;
    this.wsManager.broadcast(JSON.stringify({
      type: 'agent:message',
      data: {
        conversationId,
        fromParticipantId: context.conversation.initiatorId,
        message,
      },
      timestamp: new Date().toISOString(),
    }));

    // Wait for the user's response via WebSocket
    const response = await this.waitForResponse(conversationId);

    return {
      status: 'success',
      response,
    };
  }

  /**
   * Wait for the user to respond via WebSocket.
   * Times out after a configurable period.
   */
  private waitForResponse(conversationId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingResponses.set(conversationId, { resolve, reject });

      // Timeout after 5 minutes (configurable)
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(conversationId);
        reject(new Error('User response timed out'));
      }, 5 * 60 * 1000);

      // Store cleanup
      const original = this.pendingResponses.get(conversationId)!;
      this.pendingResponses.set(conversationId, {
        resolve: (msg) => { clearTimeout(timeout); original.resolve(msg); },
        reject: (err) => { clearTimeout(timeout); original.reject(err); },
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
```

### Key Design Properties

- **No connection = error**: If no browser is connected when an agent calls `communicate` targeting the user, `WebRuntime` returns an error immediately. The agent receives this as a tool result and can adapt (e.g., continue without user input, or report that it needs user attention).
- **Symmetric with REPLRuntime**: `REPLRuntime` blocks on terminal input; `WebRuntime` blocks on WebSocket response. The Conversation doesn't know the difference.
- **Timeout**: User responses time out after 5 minutes (configurable). The agent receives a timeout error.
- **Multiple conversations**: `pendingResponses` is keyed by conversation ID, so multiple agent-initiated conversations can be pending simultaneously.

---

## Vue SPA (Milestones 4.2–4.7)

### Technology Stack

| Concern | Choice |
|---------|--------|
| Framework | Vue 3 (Composition API, `<script setup>`) |
| Build | Vite |
| CSS | Tailwind CSS |
| State | Vue composables (`reactive`/`ref`) — no external state library |
| Router | Vue Router |
| Components | Custom (no component library) |
| Icons | Lucide Vue (lightweight, tree-shakeable) |
| Code Display | Shiki (syntax highlighting for file viewer) |

### Application Layout

```
┌──────────────────────────────────────────────────────────────┐
│  TopBar: session name, connection status, session controls   │
├──────────┬───────────────────────────────────────────────────┤
│          │                                                   │
│ Sidebar  │  Main Content Area                                │
│          │  (routed views)                                   │
│ - Chat   │                                                   │
│ - Coll.  │  ┌─ ChatView ─────────────────────────────────┐   │
│ - Sess.  │  │                                             │  │
│ - Procs  │  │  Message history (scrollable)               │  │
│ - Files  │  │  ┌─ MessageBubble ──────────────────────┐   │  │
│ - Config │  │  │ user: "Refactor the auth module"     │   │  │
│          │  │  └──────────────────────────────────────┘   │  │
│          │  │  ┌─ MessageBubble ──────────────────────┐   │  │
│          │  │  │ ur-agent: "I'll coordinate..."       │   │  │
│          │  │  │ ┌─ ToolCallBlock ─────────────────┐  │   │  │
│          │  │  │ │ 🔧 communicate → coding-agent   │  │   │  │
│          │  │  │ └────────────────────────────────┘  │   │  │
│          │  │  └──────────────────────────────────────┘   │  │
│          │  │  ┌─ ApprovalCard ───────────────────────┐   │  │
│          │  │  │ ⚠️ file_write: src/auth.ts           │   │  │
│          │  │  │ [Approve] [Reject] [reason...]       │   │  │
│          │  │  └──────────────────────────────────────┘   │  │
│          │  │                                             │  │
│          │  │  ┌─ MessageInput ───────────────────────┐   │  │
│          │  │  │ [Target: ur-agent ▼] [__________] [→]│   │  │
│          │  │  └──────────────────────────────────────┘   │  │
│          │  └─────────────────────────────────────────────┘   │
└──────────┴───────────────────────────────────────────────────┘
```

### WebSocket Client Composable

```typescript
// packages/server/web/src/composables/useWebSocket.ts
export function useWebSocket() {
  const ws = ref<WebSocket | null>(null);
  const connected = ref(false);
  const messages = ref<WSMessage[]>([]);

  function connect(url: string) {
    ws.value = new WebSocket(url);

    ws.value.onopen = () => { connected.value = true; };
    ws.value.onclose = () => {
      connected.value = false;
      // Auto-reconnect after 2s
      setTimeout(() => connect(url), 2000);
    };
    ws.value.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WSMessage;
      messages.value.push(msg);
      // Notify registered handlers (composables subscribe to event types they care about)
      handlers.value.forEach((h) => h(msg));
    };
  }

  function send(data: object) {
    ws.value?.send(JSON.stringify(data));
  }

  function onMessage(handler: (msg: WSMessage) => void): () => void {
    handlers.value.push(handler);
    return () => { handlers.value = handlers.value.filter((h) => h !== handler); };
  }

  return { connected, messages, connect, send, onMessage };
}
```

### State Management (Vue Composables)

State lives in module-scoped composables — each is called once at the app root and its reactive return value is passed down or imported directly (no global store library needed):

```
composables/
├── useWebSocket.ts   — WS connection, message dispatch, onMessage subscription
├── useApi.ts         — REST API client (fetch wrappers)
├── useSession.ts     — sessions, conversations, messages, activeConversationKey (subscribes to WS events)
├── useCollective.ts  — participants state, CRUD actions, authorization types
├── useTools.ts       — tool execution gateway (list + execute via ToolRegistry)
└── useProcesses.ts   — tracked processes, output buffers (subscribes to WS process events)
```

Each domain composable subscribes to relevant WebSocket events from `useWebSocket` and maintains its own `reactive`/`ref` state. Components import the composable directly. No Pinia, no Vuex — just Vue's built-in reactivity.

### Routing

```typescript
const routes = [
  { path: '/', redirect: '/chat' },
  { path: '/chat', component: ChatView },
  { path: '/chat/:conversationId', component: ChatView },
  { path: '/collective', component: CollectiveView },
  { path: '/sessions', component: SessionsView },
  { path: '/processes', component: ProcessesView },
  { path: '/files', component: FilesView },
  { path: '/files/:path(.*)', component: FilesView },
  { path: '/config', component: ConfigView },
];
```

---

## Milestone Breakdown

### 4.1: Server Layer ✅

**Goal**: Fastify server with REST API, WebSocket, and WebRuntime — no frontend yet, testable via curl/wscat.

1. ✅ Scaffold `packages/server` (package.json, tsconfig, tsup)
2. ✅ Add to monorepo workspaces in root package.json
3. ✅ Implement `createServer()` factory and Fastify setup
4. ✅ WebSocket plugin with `WebSocketManager` (track connections, broadcast)
5. ✅ EventBus → WS bridge
6. ✅ REST routes: collective CRUD
7. ✅ REST routes: session management + send message
8. ✅ REST routes: approval actions
9. ✅ REST routes: process management
10. ✅ REST routes: file operations (tree, read, write with workspace boundary check)
11. ✅ REST routes: workspace config
12. ✅ `WebRuntime` implementation
13. ✅ Web approval handler (delegates to WS client)
14. ✅ `legion serve` CLI command (dynamic import, optional dependency)
15. ✅ Unit + integration tests (21 server tests, 381 monorepo tests + 162 web tests)

### 4.2: Vue Chat Panel ✅

**Goal**: Working chat interface — send messages, see responses, approve/reject tools.

1. ✅ Scaffold Vue 3 + Vite + Tailwind project in `packages/server/web/`
2. ✅ `useWebSocket` composable + connection management (auto-reconnect)
3. ✅ `useSession` + `useCollective` + `useProcesses` state composables
4. ✅ App layout (sidebar, topbar, main area)
5. ✅ Chat message display (MessageBubble, ToolCallBlock)
6. ✅ Message input with target selector
7. ✅ Inline approval cards (ApprovalCard)
8. ✅ Agent activity indicators (loading/typing states, tool call display)
9. ⬚ Multi-conversation tabs — deferred (single conversation view works)
10. ✅ `@fastify/static` serves built SPA
11. ✅ Component + composable tests (162 tests via Vitest + Vue Test Utils + happy-dom)

### 4.3: Collective Management UI ✅

**Goal**: Full agent lifecycle management — create, edit, retire agents with granular authorization configuration.

1. ✅ `CollectiveView` — filterable participant list with type/status controls, retired toggle
2. ✅ `ParticipantCard` — participant summary cards with model, tool summary, edit/retire actions
3. ✅ `AgentForm` — create/edit form with collapsible `<details>` sections
4. ✅ Dynamic model loading via `list_models` tool execution (with text input fallback)
5. ✅ Model metadata display (description, context length, pricing)
6. ✅ `ToolPolicyEditor` — progressive disclosure tool authorization:
   - Presets: all-auto / all-approval / per-tool
   - Per-tool mode selectors grouped by category (Read/Write/Communication/Process)
   - Inline scope rules editor (paths, argPatterns) for granular authorization
   - Quick actions: "Read → auto", "Write → approval", "Reset defaults"
   - Dynamic tool discovery via `list_tools` execution, falls back to static categories
7. ✅ `ApprovalAuthorityEditor` — per-participant approval authority:
   - Presets: no authority / full authority / custom
   - Custom mode: participant selector dropdown, per-entry tool checkboxes by category
   - Select-all / deselect-all per category
8. ✅ Runtime limits section (maxIterations, maxCommunicationDepth, maxTurnsPerCommunication)
9. ✅ Tool execution gateway — `GET /api/tools` + `POST /api/tools/:name/execute` (generic ToolRegistry access)
10. ✅ `useTools` composable — `list()` and `execute()` wrapping tool gateway endpoints
11. ✅ `useCollective` expanded types — full authorization type hierarchy (ToolPolicy union, AuthRule, ScopeCondition, ApprovalAuthority)
12. ✅ `tool-categories.ts` utility — known tool names, categories, default modes
13. ✅ Tests: 63 collective component tests (ParticipantCard 17, AgentForm 20, ToolPolicyEditor 12, ApprovalAuthorityEditor 14) + 5 tool route server tests

### 4.4: Session Dashboard + Conversation-Aware Chat ✅

**Goal**: Multi-conversation chat with session management — conversations are first-class, sessions can be created and switched.

1. ✅ `useSession` expanded — `activeConversationKey`, `createSession()`, `switchSession()`, `loadAllSessions()`, `allSessions` ref
2. ✅ `POST /api/sessions/:id/activate` — resumes session from storage and makes it the active session
3. ✅ `ConversationList` component — conversation sidebar sorted by recency, agent picker for new conversations, last message preview
4. ✅ `ChatPanel` restructured — two-column layout (ConversationList + messages), messages bound to `activeConversationKey`
5. ✅ `MessageInput` simplified — removed target `<select>`, target determined by active conversation
6. ✅ `SessionsView` enhanced — "New Session" button, "Open" button on each session card, navigates to /chat after switch
7. ✅ `ChatView` reads `:conversationId` route param for deep linking
8. ✅ Tests: 11 ConversationList tests, 8 ChatPanel tests, 9 MessageInput tests, 4 session activation server tests

### 4.5: Process Management UI ✅

**Goal**: Real-time process monitoring — split-panel view with process list and streaming output viewer.

1. ✅ `ProcessRegistry.register()` — added `onOutput` callback for stream-level output notification
2. ✅ `process:output` event emission — wired into both `process_exec` and `process_start` tools via `emitProcessEvent()`
3. ✅ `useProcesses` composable expanded — `selectedProcessId`, `processOutput` (Record for Vue reactivity), `selectProcess()`, `loadProcessOutput()`, `startProcess()` via tool gateway, real-time `process:output` WS listener
4. ✅ `ProcessList` component — sorted list (running first, then by recency), status dot indicators (animated pulse for running), stop button per running process, "Running only" filter with count badge, `+` button to start new processes, PID/command/time display
5. ✅ `ProcessOutput` component — streaming output viewer with auto-scroll, metadata bar (PID, mode, line count, byte size, duration, exit code), stop button, auto-scroll toggle
6. ✅ `ProcessesView` restructured — two-column layout: ProcessList sidebar (w-72) + ProcessOutput viewer, start process form (command + label inputs), empty state for both no processes and no selection
7. ✅ Tests: 18 ProcessList tests, 13 ProcessOutput tests, 6 ProcessesView tests (37 total)
8. ~~Interactive process input~~ — deferred to Phase 6

### 4.6: Workspace File Explorer

1. File tree component (recursive, using `directory_list` tool via REST)
2. File content viewer with Shiki syntax highlighting
3. File editor — saves go through `file_write` tool via REST API, full authorization flow
4. File metadata display (size, modified date)

### 4.7: Workspace Configuration Editor

1. Fetch workspace config via REST
2. Schema-driven form rendering (from ConfigSchema)
3. Save config changes
4. ~~Global config editor~~ — deferred to Phase 6 (requires token auth + multi-user)

---

## Security Considerations

### Phase 4 (Single-User Local)

- Server binds to `127.0.0.1` by default — not accessible from network
- No authentication required (single user, local access)
- File operations go through authorization system (consistent with CLI)
- Only workspace config is editable (no API keys exposed)

### Phase 6 (Multi-User)

- Token-based authentication for all API endpoints and WebSocket
- Global config editor gated behind token auth
- Multi-user workspace access with user identity management
- Interactive process stdin support
- CORS configuration for non-local deployments

---

## Testing Strategy

### Server Tests

- **Unit tests**: Route handlers with mocked Workspace/Session (Vitest)
- **Integration tests**: Full Fastify instance with `fastify.inject()` — no actual HTTP
- **WebSocket tests**: WS client against test server instance

### Frontend Tests

- **Component tests**: Vitest + Vue Test Utils
- **Composable tests**: test state composables with mocked `useApi` / `useWebSocket`
- **E2E** (optional/later): Playwright or Cypress

### Test file convention

Same as core: `*.test.ts` colocated with source files.

---

## Implementation Order

Start with Milestone 4.1 (Server Layer) — everything else depends on it. Within 4.1, build in this order:

1. Package scaffolding + build setup
2. Fastify server + `createServer()` factory
3. WebSocket manager + EventBus bridge
4. Collective REST routes (simplest CRUD to validate the pattern)
5. Session + message routes
6. WebRuntime
7. Approval routes + web approval handler
8. Process + file + config routes
9. `legion serve` CLI command
10. Tests

Then 4.2 (Chat) → 4.3 (Collective) → 4.4 (Sessions) → 4.5 (Processes) → 4.6 (Files) → 4.7 (Config).
