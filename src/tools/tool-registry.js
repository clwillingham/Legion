/**
 * @typedef {Object} RegisteredTool
 * @property {import('../providers/provider.js').ToolDefinition} definition
 * @property {function(Object, Object): Promise<string>} handler - (input, context) => result string
 */

/**
 * Central registry of all available tools.
 */
export class ToolRegistry {
  /** @type {Map<string, RegisteredTool>} */
  #tools = new Map();

  /**
   * Register a Tool instance (class-based pattern).
   * @param {import('./tool.js').Tool} tool
   */
  registerTool(tool) {
    this.#tools.set(tool.name, {
      definition: tool.definition,
      handler: (input, context) => tool.execute(input, context),
    });
  }

  /**
   * Register a tool with explicit name, definition, and handler.
   * @param {string} name
   * @param {import('../providers/provider.js').ToolDefinition} definition
   * @param {function(Object, Object): Promise<string>} handler
   */
  register(name, definition, handler) {
    this.#tools.set(name, { definition, handler });
  }

  /**
   * Get a tool by name.
   * @param {string} name
   * @returns {RegisteredTool|undefined}
   */
  get(name) {
    return this.#tools.get(name);
  }

  /**
   * Get tool definitions for a list of tool names.
   * @param {string[]} names
   * @returns {import('../providers/provider.js').ToolDefinition[]}
   */
  getDefinitions(names) {
    return names
      .map(name => this.#tools.get(name)?.definition)
      .filter(Boolean);
  }

  /**
   * Get all registered tool names.
   * @returns {string[]}
   */
  listNames() {
    return [...this.#tools.keys()];
  }
}
