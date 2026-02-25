import { Tool } from '../tool.js';

/**
 * Tool for listing all available tools in the system.
 */
export class ListToolsTool extends Tool {
  #toolRegistry;

  /**
   * @param {Object} deps
   * @param {import('../../tools/tool-registry.js').ToolRegistry} deps.toolRegistry
   */
  constructor({ toolRegistry }) {
    super();
    this.#toolRegistry = toolRegistry;
  }

  get name() { return 'list_tools'; }

  get definition() {
    return {
      name: 'list_tools',
      description: `List all tools available in the system. Returns each tool's name and description. Use this to discover what tools exist so you can assign them to agents you create or modify. Not all tools are available to all agents — they must be explicitly included in an agent's tool list.`,
      inputSchema: {
        type: 'object',
        properties: {},
      },
    };
  }

  async execute(_input, _context) {
    const names = this.#toolRegistry.listNames();
    const tools = names.map(name => {
      const tool = this.#toolRegistry.get(name);
      return {
        name,
        description: tool.definition.description,
      };
    });

    return JSON.stringify(tools, null, 2);
  }
}
