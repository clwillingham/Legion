import { v4 as uuidv4 } from 'uuid';
import { Session } from './session.js';

/**
 * @typedef {Object} RunConfig
 * @property {string} id
 * @property {string} collectiveId
 * @property {string|null} name - Optional human-readable name
 * @property {string} createdAt
 * @property {string|null} endedAt
 * @property {string[]} sessionIds
 */

/**
 * Manages runs and their sessions.
 *
 * A "run" is a persistent session that spans multiple `legion start` invocations.
 * On startup, the latest run is automatically resumed with full conversation history.
 * New runs are created explicitly via `/session new`.
 * Each run contains multiple sessions (one per participant pair per session name).
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
   * @param {string|null} [name=null] - Optional human-readable name
   * @returns {Promise<string>} Run ID
   */
  async createRun(collectiveId, name = null) {
    const id = uuidv4();
    /** @type {RunConfig} */
    const config = {
      id,
      collectiveId,
      name: name || null,
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
   * Get the most recent run, regardless of whether it was ended.
   * @returns {Promise<RunConfig|null>}
   */
  async getLatestRun() {
    const runDirs = await this.#workspace.listDirs('runs');
    if (runDirs.length === 0) return null;

    /** @type {RunConfig[]} */
    const runs = [];
    for (const dir of runDirs) {
      const config = await this.#workspace.readJSON(`runs/${dir}/run.json`);
      if (config) runs.push(config);
    }

    if (runs.length === 0) return null;

    runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return runs[0];
  }

  /**
   * Load all sessions for a run into the in-memory cache.
   * @param {string} runId
   * @returns {Promise<void>}
   */
  async loadRunSessions(runId) {
    this.#sessions.clear();
    const sessionFiles = await this.#workspace.listJSON(`runs/${runId}/sessions`);
    for (const file of sessionFiles) {
      const data = await this.#workspace.readJSON(`runs/${runId}/sessions/${file}`);
      if (data) {
        const session = Session.fromJSON(data);
        this.#sessions.set(session.id, session);
      }
    }
  }

  /**
   * Resume an existing run — reopen it and load its sessions.
   * @param {string} runId
   * @returns {Promise<string>} The run ID
   */
  async resumeRun(runId) {
    const config = await this.#workspace.readJSON(`runs/${runId}/run.json`);
    if (!config) {
      throw new Error(`Run not found: ${runId}`);
    }

    // Mark as active again
    if (config.endedAt) {
      config.endedAt = null;
      await this.#workspace.writeJSON(`runs/${runId}/run.json`, config);
    }

    await this.loadRunSessions(runId);
    return runId;
  }

  /**
   * List all runs with basic metadata.
   * @returns {Promise<RunConfig[]>}
   */
  async listRuns() {
    const runDirs = await this.#workspace.listDirs('runs');
    /** @type {RunConfig[]} */
    const runs = [];
    for (const dir of runDirs) {
      const config = await this.#workspace.readJSON(`runs/${dir}/run.json`);
      if (config) runs.push(config);
    }
    runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return runs;
  }

  /**
   * Find a run by exact or partial (prefix) ID.
   * @param {string} idOrPrefix
   * @returns {Promise<RunConfig|null>}
   */
  async findRun(idOrPrefix) {
    const runDirs = await this.#workspace.listDirs('runs');
    const matches = runDirs.filter(dir => dir.startsWith(idOrPrefix));
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new Error(`Ambiguous run ID prefix "${idOrPrefix}" matches ${matches.length} runs. Be more specific.`);
    }
    return this.#workspace.readJSON(`runs/${matches[0]}/run.json`);
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
