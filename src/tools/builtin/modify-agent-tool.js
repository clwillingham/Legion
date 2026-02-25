import { Agent } from '../../collective/agent.js';

/** @type {import('../../providers/provider.js').ToolDefinition} */
export const MODIFY_AGENT_DEFINITION = {
  name: 'modify_agent',
  description: `Modify an existing agent's configuration. You can update its name, description, system prompt, model configuration, tools, and authorization policies. The agent must exist and be active. You cannot modify user participants.`,
  inputSchema: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'The ID of the agent to modify',
      },
      name: {
        type: 'string',
        description: 'New display name for the agent (optional)',
      },
      description: {
        type: 'string',
        description: 'New description of what the agent does (optional)',
      },
      systemPrompt: {
        type: 'string',
        description: 'New system prompt for the agent (optional)',
      },
      provider: {
        type: 'string',
        description: 'New LLM provider: "anthropic" or "openai" (optional)',
        enum: ['anthropic', 'openai'],
      },
      model: {
        type: 'string',
        description: 'New model identifier (optional)',
      },
      maxTokens: {
        type: 'number',
        description: 'New max tokens for response (optional)',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'New tool list (replaces existing). "communicator" is always included. (optional)',
      },
      toolAuthorizations: {
        type: 'object',
        description: 'New tool authorization policies (replaces existing). (optional)',
      },
      approvalAuthority: {
        type: 'array',
        items: { type: 'string' },
        description: 'New approval authority patterns (optional)',
      },
    },
    required: ['agentId'],
  },
};

/**
 * Create the modify_agent tool handler.
 * @param {import('../../collective/collective.js').Collective} collective
 * @param {Object} [options]
 * @param {import('../../repl/activity-logger.js').ActivityLogger} [options.activityLogger]
 * @returns {function(Object, Object): Promise<string>}
 */
export function createModifyAgentHandler(collective, options = {}) {
  const activityLogger = options.activityLogger || null;
  return async (input, context) => {
    const existing = collective.getParticipant(input.agentId);
    if (!existing) {
      return JSON.stringify({ error: `Agent "${input.agentId}" not found` });
    }

    if (existing.type !== 'agent') {
      return JSON.stringify({ error: `Participant "${input.agentId}" is a ${existing.type}, not an agent` });
    }

    if (existing.status === 'retired') {
      return JSON.stringify({ error: `Agent "${input.agentId}" is retired and cannot be modified` });
    }

    // Build updated config by merging existing with provided fields
    const existingJSON = existing.toJSON();

    const updatedConfig = {
      ...existingJSON,
      name: input.name || existingJSON.name,
      description: input.description || existingJSON.description,
      systemPrompt: input.systemPrompt || existingJSON.systemPrompt,
      modelConfig: {
        ...existingJSON.modelConfig,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
      },
    };

    // Tools: replace if provided, ensuring communicator is included
    if (input.tools) {
      const tools = [...input.tools];
      if (!tools.includes('communicator')) {
        tools.unshift('communicator');
      }
      updatedConfig.tools = tools;
    }

    // Authorization policies: replace if provided
    if (input.toolAuthorizations) {
      updatedConfig.toolAuthorizations = input.toolAuthorizations;
    }

    // Approval authority: replace if provided
    if (input.approvalAuthority) {
      updatedConfig.approvalAuthority = input.approvalAuthority;
    }

    const updatedAgent = new Agent(updatedConfig);
    await collective.updateParticipant(updatedAgent);

    // Build a summary of what changed
    const changes = [];
    if (input.name) changes.push('name');
    if (input.description) changes.push('description');
    if (input.systemPrompt) changes.push('systemPrompt');
    if (input.provider || input.model || input.maxTokens) changes.push('modelConfig');
    if (input.tools) changes.push('tools');
    if (input.toolAuthorizations) changes.push('toolAuthorizations');
    if (input.approvalAuthority) changes.push('approvalAuthority');

    activityLogger?.agentModified?.(input.agentId, context.callerId, changes);

    return JSON.stringify({
      success: true,
      agentId: updatedAgent.id,
      name: updatedAgent.name,
      modified: changes,
    });
  };
}
