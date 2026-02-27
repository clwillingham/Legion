import { Conversation, ConversationData } from './Conversation.js';
import { RuntimeRegistry } from '../runtime/RuntimeRegistry.js';
import type { RuntimeContext, RuntimeResult } from '../runtime/ParticipantRuntime.js';
import type { Collective } from '../collective/Collective.js';
import type { Storage } from '../workspace/Storage.js';
import type { EventBus } from '../events/EventBus.js';

/**
 * Session data — what gets persisted to disk.
 */
export interface SessionData {
  /** Unique session identifier */
  id: string;

  /** Human-readable session name */
  name: string;

  /** ISO 8601 creation timestamp */
  createdAt: string;

  /** Session status */
  status: 'active' | 'ended';
}

/**
 * Session — a collection of Conversations representing a single working period.
 *
 * The Session owns and manages Conversations. When the Communicate tool is used,
 * it calls Session.send(), which resolves or creates the appropriate Conversation
 * and delegates to it.
 *
 * Conversations live inside sessions and cannot cross session boundaries.
 */
export class Session {
  readonly data: SessionData;
  private conversations: Map<string, Conversation> = new Map();
  private storage: Storage;
  private runtimeRegistry: RuntimeRegistry;
  private _collective: Collective;
  private eventBus: EventBus;

  constructor(
    data: SessionData,
    storage: Storage,
    runtimeRegistry: RuntimeRegistry,
    collective: Collective,
    eventBus: EventBus,
  ) {
    this.data = data;
    this.storage = storage;
    this.runtimeRegistry = runtimeRegistry;
    this._collective = collective;
    this.eventBus = eventBus;
  }

  /**
   * Public accessor for the collective.
   */
  get collective(): Collective {
    return this._collective;
  }

  /**
   * Send a message from one participant to another within this session.
   *
   * Resolves or creates the appropriate Conversation, then delegates to it.
   * This is the primary entry point used by the Communicate tool.
   */
  async send(
    initiatorId: string,
    targetId: string,
    message: string,
    conversationName: string | undefined,
    context: RuntimeContext,
  ): Promise<RuntimeResult> {
    // Resolve target participant
    const target = this.collective.get(targetId);
    if (!target) {
      return {
        status: 'error',
        error: `Participant not found: ${targetId}`,
      };
    }

    // Resolve or create conversation
    const conversation = await this.resolveConversation(initiatorId, targetId, conversationName);

    // Delegate to conversation
    return conversation.send(message, target, {
      ...context,
      session: this,
      conversation,
    });
  }

  /**
   * Resolve an existing conversation or create a new one.
   */
  private async resolveConversation(
    initiatorId: string,
    targetId: string,
    name?: string,
  ): Promise<Conversation> {
    const key = this.conversationKey(initiatorId, targetId, name);

    let conversation = this.conversations.get(key);
    if (conversation) {
      return conversation;
    }

    // Try to load from disk
    const data = await this.loadConversationData(initiatorId, targetId, name);

    if (data) {
      conversation = new Conversation(data, this.storage, this.runtimeRegistry);
    } else {
      // Create new conversation
      const newData: ConversationData = {
        sessionId: this.data.id,
        initiatorId,
        targetId,
        name,
        messages: [],
        createdAt: new Date().toISOString(),
      };

      conversation = new Conversation(newData, this.storage, this.runtimeRegistry);

      this.eventBus.emit({
        type: 'session:started',
        sessionId: key,
        timestamp: new Date(),
      });
    }

    this.conversations.set(key, conversation);
    return conversation;
  }

  /**
   * Try to load conversation data from disk.
   */
  private async loadConversationData(
    initiatorId: string,
    targetId: string,
    name?: string,
  ): Promise<ConversationData | null> {
    const parts = [initiatorId, targetId];
    if (name) parts.push(name);
    const filePath = `sessions/${this.data.id}/conversations/${parts.join('__')}.json`;

    try {
      return await this.storage.readJSON(filePath) as ConversationData;
    } catch {
      return null;
    }
  }

  /**
   * Load all conversations for this session from disk.
   * Called during session resume to hydrate the conversation map.
   */
  private async loadAllConversations(): Promise<void> {
    const conversationsDir = `sessions/${this.data.id}/conversations`;
    const files = await this.storage.list(conversationsDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const data = await this.storage.readJSON<ConversationData>(
          `${conversationsDir}/${file}`,
        );
        const key = this.conversationKey(
          data.initiatorId,
          data.targetId,
          data.name,
        );
        const conversation = new Conversation(data, this.storage, this.runtimeRegistry);
        this.conversations.set(key, conversation);
      } catch {
        // Skip corrupted conversation files
      }
    }
  }

  /**
   * Generate a unique key for a conversation.
   */
  private conversationKey(initiatorId: string, targetId: string, name?: string): string {
    const parts = [initiatorId, targetId];
    if (name) parts.push(name);
    return parts.join('__');
  }

  /**
   * List all conversations in this session.
   */
  listConversations(): Conversation[] {
    return Array.from(this.conversations.values());
  }

  /**
   * List conversations involving a specific participant.
   */
  listConversationsFor(participantId: string): Conversation[] {
    return this.listConversations().filter(
      (c) => c.data.initiatorId === participantId || c.data.targetId === participantId,
    );
  }

  /**
   * Persist session metadata to disk.
   */
  async persist(): Promise<void> {
    await this.storage.writeJSON(`sessions/${this.data.id}/session.json`, this.data);
  }

  /**
   * End this session.
   */
  async end(): Promise<void> {
    this.data.status = 'ended';
    await this.persist();
  }

  /**
   * Create a new Session.
   */
  static create(
    name: string | undefined,
    storage: Storage,
    runtimeRegistry: RuntimeRegistry,
    collective: Collective,
    eventBus: EventBus,
  ): Session {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const sessionName = name ?? new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

    const data: SessionData = {
      id,
      name: sessionName,
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    return new Session(data, storage, runtimeRegistry, collective, eventBus);
  }

  /**
   * Resume an existing session from disk.
   *
   * Loads the session metadata and all of its persisted conversations.
   * Returns null if the session cannot be found.
   */
  static async resume(
    sessionId: string,
    storage: Storage,
    runtimeRegistry: RuntimeRegistry,
    collective: Collective,
    eventBus: EventBus,
  ): Promise<Session | null> {
    try {
      const data = await storage.readJSON<SessionData>(`sessions/${sessionId}/session.json`);
      const session = new Session(data, storage, runtimeRegistry, collective, eventBus);
      await session.loadAllConversations();
      return session;
    } catch {
      return null;
    }
  }

  /**
   * List all sessions persisted on disk.
   *
   * Scans the sessions/ directory for subdirectories containing session.json files
   * and returns their metadata. Optionally filter by status.
   */
  static async listAll(
    storage: Storage,
    filter?: { status?: 'active' | 'ended' },
  ): Promise<SessionData[]> {
    const sessionDirs = await storage.listDirs('sessions');
    const sessions: SessionData[] = [];

    for (const dir of sessionDirs) {
      try {
        const data = await storage.readJSON<SessionData>(`sessions/${dir}/session.json`);
        if (!filter?.status || data.status === filter.status) {
          sessions.push(data);
        }
      } catch {
        // Skip directories without valid session.json
      }
    }

    // Sort by creation date, newest first
    sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sessions;
  }
}
