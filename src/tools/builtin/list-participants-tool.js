/** @type {import('../../providers/provider.js').ToolDefinition} */
export const LIST_PARTICIPANTS_DEFINITION = {
  name: 'list_participants',
  description: `List all participants in the collective. Returns each participant's ID, name, type, description, and (for agents) their available tools and status.`,
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

/**
 * Create the list_participants tool handler.
 * @param {import('../../collective/collective.js').Collective} collective
 * @returns {function(Object, Object): Promise<string>}
 */
export function createListParticipantsHandler(collective) {
  return async (_input, _context) => {
    const participants = collective.getAllParticipants().map(p => {
      const info = {
        id: p.id,
        name: p.name,
        type: p.type,
        description: p.description,
      };
      if (p.type === 'agent') {
        info.tools = p.tools;
        info.status = p.status;
        info.model = `${p.modelConfig.provider}/${p.modelConfig.model}`;
      }
      return info;
    });

    return JSON.stringify(participants, null, 2);
  };
}
