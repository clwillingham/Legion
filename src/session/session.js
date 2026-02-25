/**
 * @typedef {Object} SessionEntry
 * @property {string} participantId - Who sent this message
 * @property {'user' | 'assistant'} role - Role in the session (determined by directionality)
 * @property {import('../providers/provider.js').MessageContent[]} content
 * @property {string} timestamp - ISO 8601
 */

/**
 * Represents a directional session between two participants.
 *
 * Sessions have inherent directionality:
 * - The initiator's messages always have role "user"
 * - The responder's messages always have role "assistant"
 * - Tool results always have role "user" (part of the user turn in LLM APIs)
 *
 * This eliminates the need for perspective remapping — roles are
 * determined at message-add time based on who the participant is
 * relative to the session's direction.
 */
export class Session {
  #id;
  #initiatorId;
  #responderId;
  #runId;
  #sessionName;
  #createdAt;
  /** @type {SessionEntry[]} */
  #entries = [];

  /**
   * @param {Object} config
   * @param {string} config.id
   * @param {string} config.initiatorId - The participant who starts conversations (always "user" role)
   * @param {string} config.responderId - The participant who responds (always "assistant" role)
   * @param {string} config.runId - The run this session belongs to
   * @param {string} [config.sessionName='default']
   * @param {string} [config.createdAt]
   * @param {SessionEntry[]} [config.entries]
   */
  constructor(config) {
    this.#id = config.id;
    this.#initiatorId = config.initiatorId;
    this.#responderId = config.responderId;
    this.#runId = config.runId;
    this.#sessionName = config.sessionName || 'default';
    this.#createdAt = config.createdAt || new Date().toISOString();
    this.#entries = config.entries || [];
  }

  /** @returns {string} */
  get id() { return this.#id; }

  /** @returns {string} */
  get initiatorId() { return this.#initiatorId; }

  /** @returns {string} */
  get responderId() { return this.#responderId; }

  /** @returns {string} */
  get runId() { return this.#runId; }

  /** @returns {string} */
  get sessionName() { return this.#sessionName; }

  /**
   * Append a message to the session history.
   *
   * Role is inferred automatically from the session's directionality:
   * - If the participantId matches the initiator → "user" role
   * - If the participantId matches the responder → "assistant" role
   * - Content containing tool_results always gets "user" role
   *
   * @param {string} participantId - Who is speaking
   * @param {import('../providers/provider.js').MessageContent[]} content
   */
  addMessage(participantId, content) {
    // Tool results always appear as user role (part of the user turn in LLM APIs)
    const hasToolResults = content.some(c => c.type === 'tool_result');

    /** @type {'user' | 'assistant'} */
    let role;
    if (hasToolResults) {
      role = 'user';
    } else if (participantId === this.#responderId) {
      role = 'assistant';
    } else {
      // Initiator or any other participant (e.g., sender adding a message)
      role = 'user';
    }

    this.#entries.push({
      participantId,
      role,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get the full message history formatted for an LLM call.
   *
   * Because the session owns directionality, roles are already correct —
   * no perspective remapping needed. The responder is always "assistant"
   * and the initiator is always "user".
   *
   * @returns {import('../providers/provider.js').Message[]}
   */
  getMessages() {
    return this.#entries.map(entry => ({
      role: entry.role,
      content: entry.content,
    }));
  }

  /**
   * Get all entries (raw, including participantId and timestamps).
   * @returns {SessionEntry[]}
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
      initiatorId: this.#initiatorId,
      responderId: this.#responderId,
      runId: this.#runId,
      sessionName: this.#sessionName,
      createdAt: this.#createdAt,
      entries: this.#entries,
    };
  }

  /**
   * Deserialize from JSON.
   * @param {Object} data
   * @returns {Session}
   */
  static fromJSON(data) {
    return new Session(data);
  }

  /**
   * Generate a deterministic session ID from the participant pair and session name.
   *
   * Unlike the old Conversation which sorted IDs (making A→B and B→A the same),
   * Session preserves directionality: initiator→responder order matters.
   *
   * @param {string} initiatorId
   * @param {string} responderId
   * @param {string} [sessionName='default']
   * @returns {string}
   */
  static generateId(initiatorId, responderId, sessionName = 'default') {
    return `session-${initiatorId}__${responderId}__${sessionName}`;
  }
}
