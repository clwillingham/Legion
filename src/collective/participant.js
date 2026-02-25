/**
 * @typedef {'agent' | 'user'} ParticipantType
 *
 * @typedef {Object} AuthorizationPolicy
 * @property {'auto' | 'requires_approval'} mode
 * @property {string} [approver] - Participant ID who can approve (defaults to communication chain parent)
 * @property {Object} [scope] - Granular scoping
 * @property {string[]} [scope.paths] - Allowed file paths / globs
 * @property {string[]} [scope.actions] - Allowed actions
 * @property {string[]} [scope.targets] - Allowed target participant IDs
 *
 * @typedef {Object} ParticipantConfig
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {ParticipantType} type
 * @property {Object.<string, AuthorizationPolicy>} toolAuthorizations
 * @property {string[] | string} approvalAuthority - Participant IDs this participant can approve for, or "*" for all
 */

/**
 * Base class for all participants (agents and users).
 */
export class Participant {
  #config;

  /**
   * @param {ParticipantConfig} config
   */
  constructor(config) {
    this.#config = config;
  }

  /** @returns {string} */
  get id() { return this.#config.id; }

  /** @returns {string} */
  get name() { return this.#config.name; }

  /** @returns {string} */
  get description() { return this.#config.description; }

  /** @returns {ParticipantType} */
  get type() { return this.#config.type; }

  /** @returns {Object.<string, AuthorizationPolicy>} */
  get toolAuthorizations() { return this.#config.toolAuthorizations || {}; }

  /** @returns {string[] | string} */
  get approvalAuthority() { return this.#config.approvalAuthority || []; }

  /**
   * Serialize to a plain object for JSON storage.
   * @returns {ParticipantConfig}
   */
  toJSON() {
    return { ...this.#config };
  }

  /**
   * Deserialize from a plain object. Returns the appropriate subclass
   * based on the type field.
   * @param {Object} data
   * @returns {Participant}
   */
  static fromJSON(data) {
    return new Participant(data);
  }
}
