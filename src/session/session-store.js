import { v4 as uuidv4 } from 'uuid';
import { Session } from './session.js';

/**
 * @typedef {Object} RunConfig
 * @property {string} id
 * @property {string} collectiveId
 * @property {string} createdAt
 * @property {string|null} endedAt
 * @property {string[]} sessionIds
 */

/**
 * Manages runs and their sessions.
 *
 * A "run" corresponds to one `legion start` invocation.
 * Each run contains multiple sessions (one per participant pair per session name).
 *
 * Replaces the old SessionManager + Conversation system with a simpler,
 * directional session model.
 */
export class SessionStore {
  #workspace;
  /** @type {Map<string, Session>} */
  #sessions = new Map();

  /**
   * @param {import('../storage/workspace.js').Workspace} workspace
   */
  constructor(workspace) {
    this.#workspace = workspace;
  }

  /**
   * Create a new run.
   * @param {string} collectiveId
   * @returns {Promise<string>} Run ID
   */
  async createRun(collectiveId) {
    const id = uuidv4();
    /** @type {RunConfig} */
    const config = {
      id,
      collectiveId,
      createdAt: new Date().toISOString(),
      endedAt: null,
      sessionIds: [],
    };

    await this.#workspace.writeJSON(`runs/${id}/run.json`, config);
    this.#sessions.clear();
    return id;
  }

  /**
   * Get or create a session between two participants in a run.
   *
   * Session directionality matters: initiator→responder is different
   * from responder→initiator.
   *
   * @param {string} runId
   * @param {string} initiatorId - The participant starting the conversation (user role)
   * @param {string} responderId - The participant responding (assistant role)
   * @param {string} [sessionName='default']
   * @returns {Promise<Session>}
   */
  async getOrCreateSession(runId, initiatorId, responderId, sessionName = 'default') {
    const id = Session.generateId(initiatorId, responderId, sessionName);

    if (this.#sessions.has(id)) {
      return this.#sessions.get(id);
    }

    // Try loading from disk
    const data = await this.#workspace.readJSON(
      `runs/${runId}/sessions/${id}.json`
    );
    if (data) {
      const session = Session.fromJSON(data);
      this.#sessions.set(id, session);
      return session;
    }

    // Create new session
    const session = new Session({
      id,
      initiatorId,
      responderId,
      runId,
      sessionName,
    });
    this.#sessions.set(id, session);

    // Update run config with new session ID
    const runConfig = await this.#workspace.readJSON(`runs/${runId}/run.json`);
    if (runConfig) {
      runConfig.sessionIds.push(id);
      await this.#workspace.writeJSON(`runs/${runId}/run.json`, runConfig);
    }

    return session;
  }

  /**
   * Save a session to disk.
   * @param {string} runId
   * @param {Session} session
   * @returns {Promise<void>}
   */
  async saveSession(runId, session) {
    await this.#workspace.writeJSON(
      `runs/${runId}/sessions/${session.id}.json`,
      session.toJSON()
    );
  }

  /**
   * End a run.
   * @param {string} runId
   * @returns {Promise<void>}
   */
  async endRun(runId) {
    const config = await this.#workspace.readJSON(`runs/${runId}/run.json`);
    if (config) {
      config.endedAt = new Date().toISOString();
      await this.#workspace.writeJSON(`runs/${runId}/run.json`, config);
    }
  }
}
