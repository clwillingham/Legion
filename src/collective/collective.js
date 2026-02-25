import { v4 as uuidv4 } from 'uuid';
import { Agent } from './agent.js';
import { User } from './user.js';

/**
 * @typedef {Object} CollectiveConfig
 * @property {string} id
 * @property {string} name
 * @property {string} createdAt
 * @property {string[]} participantIds
 */

/**
 * Manages the collective: participant registry and persistence.
 */
export class Collective {
  #workspace;
  /** @type {CollectiveConfig|null} */
  #config = null;
  /** @type {Map<string, import('./participant.js').Participant>} */
  #participants = new Map();

  /**
   * @param {import('../storage/workspace.js').Workspace} workspace
   */
  constructor(workspace) {
    this.#workspace = workspace;
  }

  /**
   * Initialize a new collective with default participants.
   * @param {Object} options
   * @param {string} options.name - Collective name
   * @param {string} options.userName - Human user's name
   * @param {import('./agent.js').AgentConfig[]} options.defaultAgents - Default agent configs to create
   * @returns {Promise<void>}
   */
  async initialize({ name, userName, defaultAgents }) {
    const id = uuidv4();

    // Create the user participant
    const user = new User({
      id: `user-${userName.toLowerCase().replace(/\s+/g, '-')}`,
      name: userName,
      description: 'Human user interacting via REPL',
      type: 'user',
      toolAuthorizations: {},
      approvalAuthority: '*',
      medium: { type: 'repl', config: {} },
    });

    this.#config = {
      id,
      name,
      createdAt: new Date().toISOString(),
      participantIds: [user.id],
    };

    this.#participants.set(user.id, user);
    await this.#workspace.writeJSON('collective/collective.json', this.#config);
    await this.#saveParticipant(user);

    // Create default agents
    for (const agentConfig of defaultAgents) {
      const agent = new Agent(agentConfig);
      await this.addParticipant(agent);
    }
  }

  /**
   * Load an existing collective from disk.
   * @returns {Promise<void>}
   */
  async load() {
    this.#config = await this.#workspace.readJSON('collective/collective.json');
    if (!this.#config) {
      throw new Error('No collective found. Run `legion init` first.');
    }

    this.#participants.clear();
    const files = await this.#workspace.listJSON('collective/participants');
    for (const file of files) {
      const data = await this.#workspace.readJSON(`collective/participants/${file}`);
      if (!data) continue;

      const participant = data.type === 'agent'
        ? Agent.fromJSON(data)
        : User.fromJSON(data);
      this.#participants.set(participant.id, participant);
    }
  }

  /**
   * Register a new participant in the collective.
   * @param {import('./participant.js').Participant} participant
   * @returns {Promise<void>}
   */
  async addParticipant(participant) {
    this.#participants.set(participant.id, participant);
    this.#config.participantIds.push(participant.id);
    await this.#saveParticipant(participant);
    await this.#workspace.writeJSON('collective/collective.json', this.#config);
  }

  /**
   * Update an existing participant in the collective.
   * Replaces the in-memory participant and persists to disk.
   * @param {import('./participant.js').Participant} participant
   * @returns {Promise<void>}
   */
  async updateParticipant(participant) {
    if (!this.#participants.has(participant.id)) {
      throw new Error(`Participant "${participant.id}" not found in collective`);
    }
    this.#participants.set(participant.id, participant);
    await this.#saveParticipant(participant);
  }

  /**
   * Look up a participant by ID.
   * @param {string} id
   * @returns {import('./participant.js').Participant|undefined}
   */
  getParticipant(id) {
    return this.#participants.get(id);
  }

  /**
   * Get all participants.
   * @returns {import('./participant.js').Participant[]}
   */
  getAllParticipants() {
    return [...this.#participants.values()];
  }

  /**
   * Get the collective configuration.
   * @returns {CollectiveConfig}
   */
  getConfig() {
    return { ...this.#config };
  }

  /**
   * Save a single participant to disk.
   * @param {import('./participant.js').Participant} participant
   * @returns {Promise<void>}
   */
  async #saveParticipant(participant) {
    await this.#workspace.writeJSON(
      `collective/participants/${participant.id}.json`,
      participant.toJSON()
    );
  }
}
