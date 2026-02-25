import { v4 as uuidv4 } from 'uuid';
import { Conversation } from './conversation.js';

/**
 * @typedef {Object} SessionConfig
 * @property {string} id
 * @property {string} collectiveId
 * @property {string} createdAt
 * @property {string|null} endedAt
 * @property {string[]} conversationIds
 */

/**
 * Manages sessions and their conversations.
 * A session is a working period; conversations are scoped to sessions.
 */
export class SessionManager {
  #workspace;
  /** @type {string|null} */
  #currentSessionId = null;
  /** @type {Map<string, Conversation>} */
  #conversations = new Map();

  /**
   * @param {import('../storage/workspace.js').Workspace} workspace
   */
  constructor(workspace) {
    this.#workspace = workspace;
  }

  /**
   * Create a new session.
   * @param {string} collectiveId
   * @returns {Promise<string>} Session ID
   */
  async createSession(collectiveId) {
    const id = uuidv4();
    /** @type {SessionConfig} */
    const config = {
      id,
      collectiveId,
      createdAt: new Date().toISOString(),
      endedAt: null,
      conversationIds: [],
    };

    await this.#workspace.writeJSON(`sessions/${id}/session.json`, config);
    this.#currentSessionId = id;
    this.#conversations.clear();
    return id;
  }

  /**
   * Load an existing session.
   * @param {string} sessionId
   * @returns {Promise<SessionConfig>}
   */
  async loadSession(sessionId) {
    const config = await this.#workspace.readJSON(`sessions/${sessionId}/session.json`);
    if (!config) {
      throw new Error(`Session ${sessionId} not found`);
    }
    this.#currentSessionId = sessionId;

    // Load all conversations for this session
    this.#conversations.clear();
    const files = await this.#workspace.listJSON(`sessions/${sessionId}/conversations`);
    for (const file of files) {
      const data = await this.#workspace.readJSON(`sessions/${sessionId}/conversations/${file}`);
      if (data) {
        const conv = Conversation.fromJSON(data);
        this.#conversations.set(conv.id, conv);
      }
    }

    return config;
  }

  /**
   * Get or create a conversation between two participants in the current session.
   * @param {string} sessionId
   * @param {string} participantA
   * @param {string} participantB
   * @param {string} [sessionName='default']
   * @returns {Promise<Conversation>}
   */
  async getOrCreateConversation(sessionId, participantA, participantB, sessionName = 'default') {
    const id = Conversation.generateId(participantA, participantB, sessionName);

    if (this.#conversations.has(id)) {
      return this.#conversations.get(id);
    }

    // Try loading from disk
    const data = await this.#workspace.readJSON(
      `sessions/${sessionId}/conversations/${id}.json`
    );
    if (data) {
      const conv = Conversation.fromJSON(data);
      this.#conversations.set(id, conv);
      return conv;
    }

    // Create new conversation
    const conv = new Conversation({
      id,
      participantA,
      participantB,
      sessionId,
      sessionName,
    });
    this.#conversations.set(id, conv);

    // Update session config with new conversation ID
    const sessionConfig = await this.#workspace.readJSON(`sessions/${sessionId}/session.json`);
    if (sessionConfig) {
      sessionConfig.conversationIds.push(id);
      await this.#workspace.writeJSON(`sessions/${sessionId}/session.json`, sessionConfig);
    }

    return conv;
  }

  /**
   * Save a conversation to disk.
   * @param {string} sessionId
   * @param {Conversation} conversation
   * @returns {Promise<void>}
   */
  async saveConversation(sessionId, conversation) {
    await this.#workspace.writeJSON(
      `sessions/${sessionId}/conversations/${conversation.id}.json`,
      conversation.toJSON()
    );
  }

  /**
   * End the current session.
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async endSession(sessionId) {
    const config = await this.#workspace.readJSON(`sessions/${sessionId}/session.json`);
    if (config) {
      config.endedAt = new Date().toISOString();
      await this.#workspace.writeJSON(`sessions/${sessionId}/session.json`, config);
    }
    if (this.#currentSessionId === sessionId) {
      this.#currentSessionId = null;
    }
  }

  /**
   * Get the current/active session ID.
   * @returns {string|null}
   */
  get currentSessionId() {
    return this.#currentSessionId;
  }
}
