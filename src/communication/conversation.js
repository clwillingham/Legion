/**
 * @typedef {Object} ConversationEntry
 * @property {string} participantId - Who sent this message
 * @property {'user' | 'assistant'} role - Role in the conversation context
 * @property {import('../providers/provider.js').MessageContent[]} content
 * @property {string} timestamp - ISO 8601
 */

/**
 * Represents a conversation between two participants within a session.
 * Each conversation has its own isolated message history.
 */
export class Conversation {
  #id;
  #participantA;
  #participantB;
  #sessionId;
  #sessionName;
  #createdAt;
  /** @type {ConversationEntry[]} */
  #entries = [];

  /**
   * @param {Object} config
   * @param {string} config.id
   * @param {string} config.participantA
   * @param {string} config.participantB
   * @param {string} config.sessionId
   * @param {string} [config.sessionName='default']
   * @param {string} [config.createdAt]
   * @param {ConversationEntry[]} [config.entries]
   */
  constructor(config) {
    this.#id = config.id;
    this.#participantA = config.participantA;
    this.#participantB = config.participantB;
    this.#sessionId = config.sessionId;
    this.#sessionName = config.sessionName || 'default';
    this.#createdAt = config.createdAt || new Date().toISOString();
    this.#entries = config.entries || [];
  }

  /** @returns {string} */
  get id() { return this.#id; }

  /** @returns {string} */
  get participantA() { return this.#participantA; }

  /** @returns {string} */
  get participantB() { return this.#participantB; }

  /** @returns {string} */
  get sessionId() { return this.#sessionId; }

  /** @returns {string} */
  get sessionName() { return this.#sessionName; }

  /**
   * Append a message to the conversation history.
   * @param {string} participantId - Who is speaking
   * @param {'user' | 'assistant'} role
   * @param {import('../providers/provider.js').MessageContent[]} content
   */
  addMessage(participantId, role, content) {
    this.#entries.push({
      participantId,
      role,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get the full message history formatted for an LLM call,
   * from the perspective of a specific participant.
   *
   * The agent being called always sees itself as "assistant" and the
   * other party as "user". Tool result entries always stay as "user" role
   * since they are part of the user turn in the LLM API.
   *
   * @param {string} perspectiveParticipantId - The participant viewing the conversation
   * @returns {import('../providers/provider.js').Message[]}
   */
  getMessagesForParticipant(perspectiveParticipantId) {
    /** @type {import('../providers/provider.js').Message[]} */
    const messages = [];

    for (const entry of this.#entries) {
      // Tool results always appear as user role
      const hasToolResults = entry.content.some(c => c.type === 'tool_result');
      let role;
      if (hasToolResults) {
        role = 'user';
      } else if (entry.participantId === perspectiveParticipantId) {
        role = 'assistant';
      } else {
        role = 'user';
      }

      messages.push({ role, content: entry.content });
    }

    return messages;
  }

  /**
   * Get all entries (raw, not role-mapped).
   * @returns {ConversationEntry[]}
   */
  getEntries() {
    return [...this.#entries];
  }

  /**
   * Serialize for JSON storage.
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.#id,
      participantA: this.#participantA,
      participantB: this.#participantB,
      sessionId: this.#sessionId,
      sessionName: this.#sessionName,
      createdAt: this.#createdAt,
      entries: this.#entries,
    };
  }

  /**
   * Deserialize from JSON.
   * @param {Object} data
   * @returns {Conversation}
   */
  static fromJSON(data) {
    return new Conversation(data);
  }

  /**
   * Generate a deterministic conversation ID from the participant pair and session name.
   * Sorts participant IDs so the same conversation is resolved regardless of who initiates.
   * @param {string} participantA
   * @param {string} participantB
   * @param {string} [sessionName='default']
   * @returns {string}
   */
  static generateId(participantA, participantB, sessionName = 'default') {
    const sorted = [participantA, participantB].sort();
    return `conv-${sorted[0]}__${sorted[1]}__${sessionName}`;
  }
}
