import { Tool } from '../tool.js';

/**
 * Tool for listing all participants in the collective.
 */
export class ListParticipantsTool extends Tool {
  #collective;

  /**
   * @param {Object} deps
   * @param {import('../../collective/collective.js').Collective} deps.collective
   */
  constructor({ collective }) {
    super();
    this.#collective = collective;
  }

  get name() { return 'list_participants'; }

  get definition() {
    return {
      name: 'list_participants',
      description: `List all participants in the collective. Returns each participant's ID, name, type, description, and (for agents) their available tools and status.`,
      inputSchema: {
        type: 'object',
        properties: {},
      },
    };
  }

  async execute(_input, _context) {
    const participants = this.#collective.getAllParticipants().map(p => {
      /** @type {Record<string, any>} */
      const info = {
        id: p.id,
        name: p.name,
        type: p.type,
        description: p.description,
      };
      if (p.type === 'agent') {
        const agent = /** @type {import('../../collective/agent.js').Agent} */ (p);
        info.tools = agent.tools;
        info.status = agent.status;
        info.model = `${agent.modelConfig.provider}/${agent.modelConfig.model}`;
      }
      return info;
    });

    return JSON.stringify(participants, null, 2);
  }
}
