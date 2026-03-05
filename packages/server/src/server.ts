import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Session,
  AuthEngine,
  AgentRuntime,
  MockRuntime,
  ProcessRegistry,
  ApprovalLog,
  type Workspace,
  type RuntimeContext,
} from '@legion-collective/core';
import { WebSocketManager } from './websocket/WebSocketManager.js';
import { setupEventBridge } from './websocket/bridge.js';
import { setupWSHandlers } from './websocket/handlers.js';
import { WebRuntime } from './runtime/WebRuntime.js';
import { collectiveRoutes } from './routes/collective.js';
import { sessionRoutes } from './routes/sessions.js';
import { approvalRoutes } from './routes/approvals.js';
import { processRoutes } from './routes/processes.js';
import { fileRoutes } from './routes/files.js';
import { configRoutes } from './routes/config.js';
import { toolRoutes } from './routes/tools.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface ServerOptions {
  workspace: Workspace;
  port?: number;
  host?: string;
}

export class LegionServer {
  private fastify: FastifyInstance;
  private workspace: Workspace;
  private wsManager: WebSocketManager;
  private webRuntime: WebRuntime;
  private _session: Session | null = null;
  private authEngine: AuthEngine;
  private processRegistry: ProcessRegistry;
  private _port: number;
  private _host: string;
  private approvalResponseHandler: ((requestId: string, approved: boolean, reason?: string) => void) | null = null;
  private unsubscribeEventBridge: (() => void) | null = null;

  constructor(options: ServerOptions) {
    this.workspace = options.workspace;
    this._port = options.port ?? 3000;
    this._host = options.host ?? '127.0.0.1';
    this.wsManager = new WebSocketManager();
    this.webRuntime = new WebRuntime(this.wsManager);
    this.processRegistry = new ProcessRegistry();
    ProcessRegistry.setInstance(this.processRegistry);

    const approvalLog = new ApprovalLog(this.workspace.storage.scope('sessions'));
    this.authEngine = new AuthEngine({ approvalLog, eventBus: this.workspace.eventBus });

    this.fastify = Fastify({ logger: false });
  }

  get port(): number {
    return this._port;
  }

  get session(): Session | null {
    return this._session;
  }

  /** Access the Fastify instance for testing with inject(). */
  get app(): FastifyInstance {
    return this.fastify;
  }

  setSession(session: Session): void {
    this._session = session;
  }

  getApprovalResponseHandler(): ((requestId: string, approved: boolean, reason?: string) => void) | null {
    return this.approvalResponseHandler;
  }

  createContext(): RuntimeContext {
    const userConfig = this.workspace.collective.get('user') ?? {
      id: 'user',
      type: 'user' as const,
      name: 'Web User',
      description: 'Web UI User',
      tools: {},
      approvalAuthority: {},
      status: 'active' as const,
      medium: { type: 'web' },
    };

    return {
      participant: userConfig,
      conversation: null as unknown as RuntimeContext['conversation'],
      session: this._session!,
      communicationDepth: 0,
      toolRegistry: this.workspace.toolRegistry,
      config: this.workspace.config,
      eventBus: this.workspace.eventBus,
      storage: this.workspace.storage,
      authEngine: this.authEngine,
      pendingApprovalRegistry: this.workspace.pendingApprovalRegistry,
    };
  }

  async start(): Promise<void> {
    // Register runtimes
    const webFactory = () => this.webRuntime;
    this.workspace.runtimeRegistry.register('user', webFactory);
    this.workspace.runtimeRegistry.register('user:web', webFactory);
    this.workspace.runtimeRegistry.register('agent', () => new AgentRuntime());
    this.workspace.runtimeRegistry.register('mock', () => new MockRuntime());

    // Set up web approval handler — delegates approvals to browser via WebSocket.
    // The approval:requested event is already emitted by AuthEngine via the EventBus,
    // which the EventBus→WS bridge forwards to all connected clients.
    // We only need to register the response handler here.
    this.authEngine.setApprovalHandler((request) => {
      return new Promise((resolve) => {
        this.approvalResponseHandler = (requestId, approved, reason) => {
          if (requestId === request.id) {
            this.approvalResponseHandler = null;
            resolve({ approved, reason });
          }
        };
      });
    });

    // Register WebSocket plugin
    await this.fastify.register(fastifyWebsocket);

    // Serve built Vue SPA as static files
    const webDistPath = join(__dirname, '..', 'web', 'dist');
    try {
      await this.fastify.register(fastifyStatic, {
        root: webDistPath,
        prefix: '/',
        wildcard: false,
      });
    } catch {
      // web/dist may not exist yet during development
    }

    // API routes
    const getServer = () => this;
    await this.fastify.register(
      async (app) => {
        await app.register(collectiveRoutes, { workspace: this.workspace });
        await app.register(sessionRoutes, { workspace: this.workspace, getServer });
        await app.register(approvalRoutes, { workspace: this.workspace, getServer });
        await app.register(processRoutes);
        await app.register(fileRoutes, { workspace: this.workspace });
        await app.register(configRoutes, { workspace: this.workspace });
        await app.register(toolRoutes, { workspace: this.workspace, getServer });
      },
      { prefix: '/api' },
    );

    // WebSocket endpoint
    this.fastify.get('/ws', { websocket: true }, (socket) => {
      this.wsManager.add(socket);
      setupWSHandlers(
        socket,
        () => this._session,
        () => this.createContext(),
        this.webRuntime,
        () => this.approvalResponseHandler,
      );
    });

    // SPA fallback — serve index.html for non-API, non-WS, non-static routes
    this.fastify.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      try {
        return reply.sendFile('index.html');
      } catch {
        return reply.code(404).send({ error: 'Web interface not built. Run the Vue build first.' });
      }
    });

    // Set up EventBus → WS bridge
    this.unsubscribeEventBridge = setupEventBridge(this.workspace.eventBus, this.wsManager);

    // Create default session
    this._session = Session.create(
      undefined,
      this.workspace.storage,
      this.workspace.runtimeRegistry,
      this.workspace.collective,
      this.workspace.eventBus,
    );
    await this._session.persist();

    await this.fastify.listen({ port: this._port, host: this._host });
  }

  async stop(): Promise<void> {
    this.unsubscribeEventBridge?.();
    await this.processRegistry.killAll();
    await this.fastify.close();
  }
}
