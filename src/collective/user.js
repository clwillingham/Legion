import { Participant } from './participant.js';

/**
 * @typedef {Object} MediumConfig
 * @property {'repl' | 'web' | 'api'} type
 * @property {Object} [config] - Medium-specific configuration
 */

/**
 * @typedef {Object} UserConfig
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {'user'} type
 * @property {Object.<string, import('./participant.js').AuthorizationPolicy>} toolAuthorizations
 * @property {string[] | string} approvalAuthority
 * @property {MediumConfig} [medium]
 */

/**
 * A human user participant.
 * @extends Participant
 */
export class User extends Participant {
  #medium;

  /**
   * @param {UserConfig} config
   */
  constructor(config) {
    super({ ...config, type: 'user' });
    this.#medium = config.medium || { type: 'repl', config: {} };
  }

  /** @returns {MediumConfig} */
  get medium() { return this.#medium; }

  /**
   * Handle an incoming message by prompting the user via REPL.
   *
   * @param {import('./participant.js').HandleMessageParams & {
   *   deps: { repl: import('../repl/repl.js').Repl }
   * }} params
   * @returns {Promise<string>}
   */
  async handleMessage({ senderName, message, deps }) {
    deps.repl.displayMessage(senderName, message);
    return deps.repl.prompt(`[Reply to ${senderName}] > `);
  }

  /**
   * @returns {UserConfig}
   */
  toJSON() {
    return {
      ...super.toJSON(),
      type: /** @type {'user'} */ ('user'),
      medium: { ...this.#medium },
    };
  }

  /**
   * @param {UserConfig} data
   * @returns {User}
   */
  static fromJSON(data) {
    return new User(data);
  }
}
