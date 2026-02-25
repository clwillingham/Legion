/**
 * @typedef {Object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {Object} inputSchema - JSON Schema for the tool's input
 */

/**
 * Base class for all tools in Legion.
 *
 * Subclasses must implement:
 * - get name() → string
 * - get definition() → ToolDefinition
 * - async execute(input, context) → string
 *
 * @abstract
 */
export class Tool {
  /**
   * The tool's unique name (e.g., "file_read", "communicator").
   * @returns {string}
   * @abstract
   */
  get name() {
    throw new Error(`${this.constructor.name} must implement get name()`);
  }

  /**
   * The tool definition sent to the LLM provider.
   * @returns {ToolDefinition}
   * @abstract
   */
  get definition() {
    throw new Error(`${this.constructor.name} must implement get definition()`);
  }

  /**
   * Execute the tool with the given input.
   * @param {Object} input - Parsed tool arguments from the LLM
   * @param {Object} context - Execution context
   * @param {string} context.sessionId - Current session/run ID
   * @param {string} context.senderId - Who initiated communication with the calling agent
   * @param {string} context.callerId - The participant making this tool call
   * @param {string[]} [context.communicationChain] - Chain of sender IDs
   * @param {string} [context.activeSessionId] - Session ID the calling tool loop is building
   * @param {import('../authorization/suspension-handler.js').SuspensionHandler} [context.suspensionHandler]
   * @returns {Promise<string>} Result string returned to the LLM
   * @abstract
   */
  async execute(input, context) {
    throw new Error(`${this.constructor.name} must implement execute()`);
  }
}
