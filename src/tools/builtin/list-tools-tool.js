/** @type {import('../../providers/provider.js').ToolDefinition} */
export const LIST_TOOLS_DEFINITION = {
  name: 'list_tools',
  description: `List all tools available in the system. Returns each tool's name and description. Use this to discover what tools exist so you can assign them to agents you create or modify. Not all tools are available to all agents — they must be explicitly included in an agent's tool list.`,
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

/**
 * Create the list_tools tool handler.
 * @param {import('../../tools/tool-registry.js').ToolRegistry} toolRegistry
 * @returns {function(Object, Object): Promise<string>}
 */
export function createListToolsHandler(toolRegistry) {
  return async (_input, _context) => {
    const names = toolRegistry.listNames();
    const tools = names.map(name => {
      const tool = toolRegistry.get(name);
      return {
        name,
        description: tool.definition.description,
      };
    });

    return JSON.stringify(tools, null, 2);
  };
}
