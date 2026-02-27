import type { Tool, ToolResult, JSONSchema } from './Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';
import {
  AgentConfigSchema,
  type AgentConfig,
} from '../collective/Participant.js';

/**
 * agent-tools — tools for managing agents in the collective.
 *
 * These are write operations used primarily by the Resource Agent
 * to dynamically create, modify, and retire agents.
 */

// ============================================================
// create_agent — create a new agent in the collective
// ============================================================

export const createAgentTool: Tool = {
  name: 'create_agent',
  description:
    'Create a new AI agent in the collective. ' +
    'Specify the agent\'s ID, name, role, model, and system prompt. ' +
    'The agent will be persisted to disk and available for communication immediately.',

  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the agent (lowercase, no spaces — e.g. "code-reviewer").',
      },
      name: {
        type: 'string',
        description: 'Display name for the agent (e.g. "Code Reviewer").',
      },
      description: {
        type: 'string',
        description: 'Brief description of the agent\'s role and purpose.',
      },
      systemPrompt: {
        type: 'string',
        description:
          'The system prompt that defines the agent\'s behavior, expertise, and guidelines.',
      },
      provider: {
        type: 'string',
        enum: ['anthropic', 'openai', 'openrouter'],
        description:
          'LLM provider to use. Defaults to the workspace default provider.',
      },
      model: {
        type: 'string',
        description:
          'Model name (e.g. "claude-sonnet-4-6", "gpt-4o"). Defaults to the provider\'s default model.',
      },
      tools: {
        type: 'object',
        description:
          'Tool access configuration. Keys are tool names (or "*" for all tools), ' +
          'values are objects with a "mode" field ("auto" or "requires_approval"). ' +
          'Defaults to {"communicate": {"mode": "auto"}, "list_participants": {"mode": "auto"}}.',
      },
      temperature: {
        type: 'number',
        description: 'Model temperature (0-2). Optional.',
      },
      maxTokens: {
        type: 'number',
        description: 'Maximum tokens per response. Optional.',
      },
    },
    required: ['id', 'name', 'description', 'systemPrompt'],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const {
      id,
      name,
      description,
      systemPrompt,
      provider,
      model,
      tools,
      temperature,
      maxTokens,
    } = args as {
      id: string;
      name: string;
      description: string;
      systemPrompt: string;
      provider?: string;
      model?: string;
      tools?: Record<string, { mode: string }>;
      temperature?: number;
      maxTokens?: number;
    };

    if (!id || !name || !description || !systemPrompt) {
      return {
        status: 'error',
        error: 'id, name, description, and systemPrompt are all required.',
      };
    }

    const collective = context.session.collective;

    // Check for duplicate ID
    if (collective.has(id)) {
      return {
        status: 'error',
        error: `A participant with ID "${id}" already exists. Choose a different ID.`,
      };
    }

    // Resolve provider and model defaults
    const resolvedProvider =
      provider ??
      (context.config.get('defaultProvider') as string | undefined) ??
      'anthropic';

    const defaultModels: Record<string, string> = {
      anthropic: 'claude-sonnet-4-6',
      openai: 'gpt-4o',
      openrouter: 'anthropic/claude-sonnet-4-6',
    };

    const resolvedModel = model ?? defaultModels[resolvedProvider] ?? 'claude-sonnet-4-6';

    // Default tools: communicate + list_participants
    const resolvedTools = tools ?? {
      communicate: { mode: 'auto' },
      list_participants: { mode: 'auto' },
    };

    // Build and validate the config through the Zod schema
    try {
      const config = AgentConfigSchema.parse({
        id,
        name,
        type: 'agent',
        description,
        systemPrompt,
        model: {
          provider: resolvedProvider,
          model: resolvedModel,
          ...(temperature !== undefined ? { temperature } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
        },
        tools: resolvedTools,
        createdBy: context.participant.id,
        createdAt: new Date().toISOString(),
      });

      await collective.save(config);

      return {
        status: 'success',
        data: JSON.stringify(
          {
            message: `Agent "${id}" created successfully.`,
            agent: {
              id: config.id,
              name: config.name,
              description: config.description,
              model: `${config.model.provider}/${config.model.model}`,
              toolCount: Object.keys(config.tools).length,
            },
          },
          null,
          2,
        ),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: `Failed to create agent: ${msg}`,
      };
    }
  },
};

// ============================================================
// modify_agent — update an existing agent's configuration
// ============================================================

export const modifyAgentTool: Tool = {
  name: 'modify_agent',
  description:
    'Modify an existing agent\'s configuration. ' +
    'You can update the name, description, system prompt, model, tools, or runtime config. ' +
    'Only the fields you provide will be changed; everything else stays the same.',

  parameters: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'The ID of the agent to modify.',
      },
      name: {
        type: 'string',
        description: 'New display name.',
      },
      description: {
        type: 'string',
        description: 'New description.',
      },
      systemPrompt: {
        type: 'string',
        description: 'New system prompt.',
      },
      provider: {
        type: 'string',
        enum: ['anthropic', 'openai', 'openrouter'],
        description: 'New LLM provider.',
      },
      model: {
        type: 'string',
        description: 'New model name.',
      },
      tools: {
        type: 'object',
        description:
          'New tool access configuration (replaces the existing one entirely). ' +
          'Keys are tool names (or "*"), values are objects with a "mode" field.',
      },
      temperature: {
        type: 'number',
        description: 'New temperature setting (0-2).',
      },
      maxTokens: {
        type: 'number',
        description: 'New max tokens setting.',
      },
      maxIterations: {
        type: 'number',
        description: 'New max iterations per turn.',
      },
    },
    required: ['agentId'],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const {
      agentId,
      name,
      description,
      systemPrompt,
      provider,
      model,
      tools,
      temperature,
      maxTokens,
      maxIterations,
    } = args as {
      agentId: string;
      name?: string;
      description?: string;
      systemPrompt?: string;
      provider?: string;
      model?: string;
      tools?: Record<string, { mode: string }>;
      temperature?: number;
      maxTokens?: number;
      maxIterations?: number;
    };

    if (!agentId) {
      return { status: 'error', error: 'agentId is required.' };
    }

    const collective = context.session.collective;
    const existing = collective.get(agentId);

    if (!existing) {
      return {
        status: 'error',
        error: `Participant "${agentId}" not found.`,
      };
    }

    if (existing.type !== 'agent') {
      return {
        status: 'error',
        error: `Participant "${agentId}" is a ${existing.type}, not an agent. Only agents can be modified with this tool.`,
      };
    }

    const agent = existing as AgentConfig;

    // Build the updated model config
    const updatedModel = {
      ...agent.model,
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    };

    // Build runtime overrides if maxIterations provided
    const updatedRuntimeConfig =
      maxIterations !== undefined
        ? { ...(agent.runtimeConfig ?? {}), maxIterations }
        : agent.runtimeConfig;

    // Build the full updated config
    try {
      const updated = AgentConfigSchema.parse({
        ...agent,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(systemPrompt !== undefined ? { systemPrompt } : {}),
        ...(tools !== undefined ? { tools } : {}),
        model: updatedModel,
        runtimeConfig: updatedRuntimeConfig,
      });

      await collective.save(updated);

      // Summarize what changed
      const changes: string[] = [];
      if (name !== undefined) changes.push('name');
      if (description !== undefined) changes.push('description');
      if (systemPrompt !== undefined) changes.push('systemPrompt');
      if (provider !== undefined) changes.push('provider');
      if (model !== undefined) changes.push('model');
      if (tools !== undefined) changes.push('tools');
      if (temperature !== undefined) changes.push('temperature');
      if (maxTokens !== undefined) changes.push('maxTokens');
      if (maxIterations !== undefined) changes.push('maxIterations');

      return {
        status: 'success',
        data: JSON.stringify(
          {
            message: `Agent "${agentId}" updated successfully.`,
            fieldsChanged: changes,
            agent: {
              id: updated.id,
              name: updated.name,
              description: updated.description,
              model: `${updated.model.provider}/${updated.model.model}`,
            },
          },
          null,
          2,
        ),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: `Failed to modify agent: ${msg}`,
      };
    }
  },
};

// ============================================================
// retire_agent — mark an agent as retired
// ============================================================

export const retireAgentTool: Tool = {
  name: 'retire_agent',
  description:
    'Retire an agent from the collective. ' +
    'The agent\'s configuration is preserved on disk but it will no longer ' +
    'be active or available for communication. This is reversible.',

  parameters: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'The ID of the agent to retire.',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for retiring the agent.',
      },
    },
    required: ['agentId'],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const { agentId, reason } = args as {
      agentId: string;
      reason?: string;
    };

    if (!agentId) {
      return { status: 'error', error: 'agentId is required.' };
    }

    // Prevent retiring critical participants
    if (agentId === 'user') {
      return {
        status: 'error',
        error: 'Cannot retire the user participant.',
      };
    }

    const collective = context.session.collective;
    const existing = collective.get(agentId);

    if (!existing) {
      return {
        status: 'error',
        error: `Participant "${agentId}" not found.`,
      };
    }

    if (existing.type !== 'agent') {
      return {
        status: 'error',
        error: `Participant "${agentId}" is a ${existing.type}, not an agent. Only agents can be retired with this tool.`,
      };
    }

    if (existing.status === 'retired') {
      return {
        status: 'error',
        error: `Agent "${agentId}" is already retired.`,
      };
    }

    try {
      await collective.retire(agentId);

      return {
        status: 'success',
        data: JSON.stringify(
          {
            message: `Agent "${agentId}" has been retired.${reason ? ` Reason: ${reason}` : ''}`,
            agent: {
              id: existing.id,
              name: existing.name,
              previousStatus: existing.status,
              newStatus: 'retired',
            },
          },
          null,
          2,
        ),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: `Failed to retire agent: ${msg}`,
      };
    }
  },
};

// ============================================================
// list_tools — list all available tools in the registry
// ============================================================

export const listToolsTool: Tool = {
  name: 'list_tools',
  description:
    'List all tools registered in the workspace. Returns each tool\'s name, ' +
    'description, and parameter schema. Use this to understand what capabilities ' +
    'are available when configuring agents.',

  parameters: {
    type: 'object',
    properties: {
      verbose: {
        type: 'boolean',
        description:
          'If true, include the full parameter schema for each tool. Default false.',
      },
    },
    required: [],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const { verbose = false } = args as { verbose?: boolean };

    const allTools = context.toolRegistry.listAll();

    const toolList = allTools.map((t) => {
      const entry: Record<string, unknown> = {
        name: t.name,
        description: t.description,
      };
      if (verbose) {
        entry.parameters = t.parameters;
      }
      return entry;
    });

    return {
      status: 'success',
      data: JSON.stringify(
        {
          count: toolList.length,
          tools: toolList,
        },
        null,
        2,
      ),
    };
  },
};

// ============================================================
// All agent management tools bundled for easy registration
// ============================================================

export const agentTools: Tool[] = [
  createAgentTool,
  modifyAgentTool,
  retireAgentTool,
  listToolsTool,
];
