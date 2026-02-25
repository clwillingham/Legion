import { Agent } from '../../collective/agent.js';

/** @type {import('../../providers/provider.js').ToolDefinition} */
export const SPAWN_AGENT_DEFINITION = {
  name: 'spawn_agent',
  description: `Create a new AI agent in the collective. The agent will persist across sessions and be available for communication. You must specify an ID (lowercase with hyphens), name, description, system prompt, and model configuration. The agent will automatically have access to the communicator tool. You can optionally configure toolAuthorizations and approvalAuthority for fine-grained permission control.`,
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Unique identifier for the agent (lowercase, hyphens allowed, e.g., "coding-agent-1")',
      },
      name: {
        type: 'string',
        description: 'Display name for the agent (e.g., "Coding Agent")',
      },
      description: {
        type: 'string',
        description: 'What this agent does and specializes in',
      },
      systemPrompt: {
        type: 'string',
        description: 'The system prompt defining the agent\'s role, personality, and guidelines',
      },
      provider: {
        type: 'string',
        description: 'LLM provider: "anthropic" or "openai"',
        enum: ['anthropic', 'openai'],
      },
      model: {
        type: 'string',
        description: 'Model identifier (e.g., "claude-sonnet-4-20250514", "gpt-4o")',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tool names this agent should have access to. "communicator" is always included.',
      },
      toolAuthorizations: {
        type: 'object',
        description: 'Authorization policies controlling which tools need approval. Keys are tool names or glob patterns (e.g., "file_write", "file_*", "*"). Values are objects with "mode" ("auto" or "requires_approval") and optional "approver" (participant ID). Example: {"*": {"mode": "auto"}, "file_delete": {"mode": "requires_approval"}}. Defaults to {"*": {"mode": "auto"}} (all tools auto-approved).',
      },
      approvalAuthority: {
        type: 'array',
        items: { type: 'string' },
        description: 'Participant ID patterns this agent can approve tool calls for. Use "*" to approve for any participant, or specific IDs/patterns like "coding-agent-*". Defaults to [] (cannot approve for anyone).',
      },
    },
    required: ['id', 'name', 'description', 'systemPrompt', 'provider', 'model'],
  },
};

/**
 * Create the spawn_agent tool handler.
 * @param {import('../../collective/collective.js').Collective} collective
 * @param {Object} [options]
 * @param {import('../../repl/activity-logger.js').ActivityLogger} [options.activityLogger]
 * @returns {function(Object, Object): Promise<string>}
 */
export function createSpawnAgentHandler(collective, options = {}) {
  const activityLogger = options.activityLogger || null;
  return async (input, context) => {
    // Ensure communicator is always included
    const tools = input.tools || [];
    if (!tools.includes('communicator')) {
      tools.unshift('communicator');
    }

    // Check if agent already exists
    if (collective.getParticipant(input.id)) {
      return JSON.stringify({ error: `Agent "${input.id}" already exists` });
    }

    const agent = new Agent({
      id: input.id,
      name: input.name,
      description: input.description,
      type: 'agent',
      systemPrompt: input.systemPrompt,
      modelConfig: {
        provider: input.provider,
        model: input.model,
        maxTokens: 4096,
      },
      tools,
      toolAuthorizations: input.toolAuthorizations || {
        '*': { mode: 'auto' },
      },
      approvalAuthority: input.approvalAuthority || [],
      createdBy: context.callerId,
      createdAt: new Date().toISOString(),
      status: 'active',
    });

    await collective.addParticipant(agent);
    activityLogger?.agentCreated(agent.id, context.callerId);

    return JSON.stringify({
      success: true,
      agentId: agent.id,
      name: agent.name,
      tools: agent.tools,
      toolAuthorizations: agent.toJSON().toolAuthorizations,
      approvalAuthority: agent.toJSON().approvalAuthority,
    });
  };
}
