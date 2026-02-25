import { Agent } from '../../collective/agent.js';

/** @type {import('../../providers/provider.js').ToolDefinition} */
export const RETIRE_AGENT_DEFINITION = {
  name: 'retire_agent',
  description: `Retire an agent from the collective. The agent will be marked as retired and will no longer be available for communication or tool execution. This does not delete the agent's data — it's a soft retirement that preserves history. You cannot retire user participants or already-retired agents.`,
  inputSchema: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'The ID of the agent to retire',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for retiring this agent',
      },
    },
    required: ['agentId'],
  },
};

/**
 * Create the retire_agent tool handler.
 * @param {import('../../collective/collective.js').Collective} collective
 * @param {Object} [options]
 * @param {import('../../repl/activity-logger.js').ActivityLogger} [options.activityLogger]
 * @returns {function(Object, Object): Promise<string>}
 */
export function createRetireAgentHandler(collective, options = {}) {
  const activityLogger = options.activityLogger || null;
  return async (input, context) => {
    const existing = collective.getParticipant(input.agentId);
    if (!existing) {
      return JSON.stringify({ error: `Agent "${input.agentId}" not found` });
    }

    if (existing.type !== 'agent') {
      return JSON.stringify({ error: `Participant "${input.agentId}" is a ${existing.type}, not an agent. Only agents can be retired.` });
    }

    if (existing.status === 'retired') {
      return JSON.stringify({ error: `Agent "${input.agentId}" is already retired` });
    }

    // Protect built-in agents from accidental retirement
    const protectedIds = ['ur-agent', 'resource-agent'];
    if (protectedIds.includes(input.agentId)) {
      return JSON.stringify({
        error: `Agent "${input.agentId}" is a core agent and cannot be retired. You can modify it instead.`,
      });
    }

    // Create a retired copy of the agent
    const existingJSON = existing.toJSON();
    const retiredConfig = {
      ...existingJSON,
      status: 'retired',
    };

    const retiredAgent = new Agent(retiredConfig);
    await collective.updateParticipant(retiredAgent);

    activityLogger?.agentRetired?.(input.agentId, context.callerId, input.reason);

    return JSON.stringify({
      success: true,
      agentId: retiredAgent.id,
      name: retiredAgent.name,
      status: 'retired',
      reason: input.reason || 'No reason provided',
    });
  };
}
