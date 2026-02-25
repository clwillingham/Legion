import { Participant } from './participant.js';

/**
 * @typedef {Object} ModelConfig
 * @property {string} provider - Provider name: "anthropic" or "openai"
 * @property {string} model - Model identifier (e.g., "claude-sonnet-4-20250514", "gpt-4o")
 * @property {number} [maxTokens=4096] - Max tokens for response
 * @property {number} [temperature] - Sampling temperature
 */

/**
 * @typedef {Object} AgentConfig
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {'agent'} type
 * @property {string} systemPrompt
 * @property {ModelConfig} modelConfig
 * @property {string[]} tools - Tool names this agent has access to
 * @property {Object.<string, import('./participant.js').AuthorizationPolicy>} toolAuthorizations
 * @property {string[]} approvalAuthority
 * @property {string} [createdBy] - ID of participant who created this agent
 * @property {string} [createdAt] - ISO timestamp
 * @property {'active' | 'retired'} [status]
 */

/**
 * An AI agent participant.
 * @extends Participant
 */
export class Agent extends Participant {
  #systemPrompt;
  #modelConfig;
  #tools;
  #createdBy;
  #createdAt;
  #status;

  /**
   * @param {AgentConfig} config
   */
  constructor(config) {
    super({ ...config, type: 'agent' });
    this.#systemPrompt = config.systemPrompt;
    this.#modelConfig = config.modelConfig;
    this.#tools = config.tools || [];
    this.#createdBy = config.createdBy || null;
    this.#createdAt = config.createdAt || new Date().toISOString();
    this.#status = config.status || 'active';
  }

  /** @returns {string} */
  get systemPrompt() { return this.#systemPrompt; }

  /** @returns {ModelConfig} */
  get modelConfig() { return this.#modelConfig; }

  /** @returns {string[]} Tool names */
  get tools() { return this.#tools; }

  /** @returns {string|null} */
  get createdBy() { return this.#createdBy; }

  /** @returns {string} */
  get createdAt() { return this.#createdAt; }

  /** @returns {'active' | 'retired'} */
  get status() { return this.#status; }

  /**
   * Handle an incoming message by running the LLM tool-use loop.
   *
   * @param {import('./participant.js').HandleMessageParams & {
   *   deps: {
   *     agentRuntime: import('../runtime/agent-runtime.js').AgentRuntime,
   *     runId: string,
   *     communicationChain?: string[],
   *     suspensionHandler?: import('../authorization/suspension-handler.js').SuspensionHandler,
   *   }
   * }} params
   * @returns {Promise<string>}
   */
  async handleMessage({ session, senderId, deps }) {
    return deps.agentRuntime.runToolLoop({
      agent: this,
      session,
      senderId,
      runId: deps.runId,
      communicationChain: deps.communicationChain || [],
      suspensionHandler: deps.suspensionHandler,
    });
  }

  /**
   * @returns {AgentConfig}
   */
  toJSON() {
    const base = super.toJSON();
    return {
      id: base.id,
      name: base.name,
      description: base.description,
      type: /** @type {'agent'} */ ('agent'),
      toolAuthorizations: base.toolAuthorizations,
      approvalAuthority: Array.isArray(base.approvalAuthority)
        ? base.approvalAuthority
        : [base.approvalAuthority],
      systemPrompt: this.#systemPrompt,
      modelConfig: { ...this.#modelConfig },
      tools: [...this.#tools],
      createdBy: this.#createdBy,
      createdAt: this.#createdAt,
      status: this.#status,
    };
  }

  /**
   * @param {AgentConfig} data
   * @returns {Agent}
   */
  static fromJSON(data) {
    return new Agent(data);
  }
}
