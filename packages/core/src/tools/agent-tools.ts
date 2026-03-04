import type { Tool, ToolResult, JSONSchema } from './Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';
import {
  AgentConfigSchema,
  type AgentConfig,
} from '../collective/Participant.js';
import { createProvider } from '../providers/ProviderFactory.js';
import type { ListModelsOptions, ModelInfo, ProviderConfig } from '../providers/Provider.js';
import {
  filterAndPaginateModels,
  formatModelsCompact,
} from '../providers/known-models.js';

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
        description:
          'LLM provider to use. Built-in options: "anthropic", "openai", "openrouter". ' +
          'Custom compatible providers: any name configured in your workspace ' +
          '(use list_providers to see available names). Defaults to the workspace default provider.',
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
      approvalAuthority: {
        description:
          'Approval delegation authority — controls which tool calls the agent can approve inline ' +
          'for downstream agents it delegates to via communicate. ' +
          'Use "*" for full authority over everything. ' +
          'Use a record mapping participant IDs (or "*" for any agent) to an allow-list of tool names, ' +
          'e.g. {"*": ["file_write", "process_exec"]}. ' +
          'For fine-grained scope control, use a rules map per tool: ' +
          '{"*": {"file_write": [{"mode": "auto", "scope": {"paths": ["src/**"]}}, {"mode": "deny"}]}}. ' +
          'Defaults to {} (no delegation authority — all approvals escalate to the user).',
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
      approvalAuthority,
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
      approvalAuthority?: unknown;
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

    const builtinDefaultModels: Record<string, string> = {
      anthropic: 'claude-sonnet-4-6',
      openai: 'gpt-4o',
      openrouter: 'anthropic/claude-sonnet-4-6',
    };

    // For custom providers, prefer the stored defaultModel over the built-in fallbacks.
    const storedDefault = context.config.getProviderConfig(resolvedProvider)?.defaultModel;
    const resolvedModel =
      model ?? storedDefault ?? builtinDefaultModels[resolvedProvider] ?? 'gpt-4o';

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
        ...(approvalAuthority !== undefined ? { approvalAuthority } : {}),
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
        description:
          'New LLM provider. Built-in options: "anthropic", "openai", "openrouter". ' +
          'Custom compatible providers: any name configured in your workspace ' +
          '(use list_providers to see available names).',
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
      approvalAuthority: {
        description:
          'New approval delegation authority (replaces existing). ' +
          'Use "*" for full authority, a record of participantId → ["tool1", "tool2"] for simple ' +
          'allow-lists, or a rules map for scope-based control. Set to {} to remove all authority.',
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
      approvalAuthority,
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
      approvalAuthority?: unknown;
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
        ...(approvalAuthority !== undefined ? { approvalAuthority } : {}),
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
      if (approvalAuthority !== undefined) changes.push('approvalAuthority');

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
// list_models — search and list available models from providers
// ============================================================

export const listModelsTool: Tool = {
  name: 'list_models',
  description:
    'Search and list available LLM models from configured providers. ' +
    'Supports filtering by provider, searching by name/ID, sorting by price or context length, ' +
    'and paginated results. Returns model IDs, names, pricing, and context window information.',

  parameters: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        description:
          'Filter to a single provider. Built-in options: "anthropic", "openai", "openrouter". ' +
          'Custom compatible providers: any name configured in your workspace ' +
          '(use list_providers to see available names). Omit to query all configured providers.',
      },
      search: {
        type: 'string',
        description:
          'Search models by name, ID, or description (case-insensitive substring match).',
      },
      sortBy: {
        type: 'string',
        enum: ['name', 'price_prompt', 'price_completion', 'context_length', 'created'],
        description: 'Sort results by this field. Default: name.',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction. Default: asc.',
      },
      limit: {
        type: 'number',
        description: 'Maximum models to return per page (default 20).',
      },
      offset: {
        type: 'number',
        description: 'Pagination offset (default 0).',
      },
      format: {
        type: 'string',
        enum: ['compact', 'json'],
        description:
          'Output format. "compact" returns a concise table-like summary. ' +
          '"json" returns full ModelInfo objects with pagination metadata. Default: compact.',
      },
      category: {
        type: 'string',
        description: 'OpenRouter-specific category filter (e.g. "programming", "roleplay").',
      },
    },
    required: [],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const {
      provider: providerFilter,
      search,
      sortBy,
      sortOrder,
      limit,
      offset,
      format = 'compact',
      category,
    } = args as {
      provider?: string;
      search?: string;
      sortBy?: ListModelsOptions['sortBy'];
      sortOrder?: 'asc' | 'desc';
      limit?: number;
      offset?: number;
      format?: 'compact' | 'json';
      category?: string;
    };

    const config = context.config;

    // Determine which providers to query.
    // Include all configured providers (workspace + global), plus the three built-ins
    // if an API key is resolvable for them.
    const configuredProviders = Object.keys(config.get('providers') ?? {});
    const builtinProviders = ['anthropic', 'openai', 'openrouter'];
    const allKnownProviders = [
      ...new Set([...builtinProviders, ...configuredProviders]),
    ];

    const providersToQuery = providerFilter
      ? [providerFilter]
      : allKnownProviders.filter((name) => {
          const entry = config.getProviderConfig(name);
          const adapterType = entry?.type ?? entry?.provider ?? (builtinProviders.includes(name) ? name : 'openai-compatible');
          const isLocalCompatible = adapterType === 'openai-compatible';
          // Include if an API key is available, or if it's a local-compatible provider
          return !!(config.resolveApiKey(name) || isLocalCompatible);
        });

    if (providersToQuery.length === 0) {
      return {
        status: 'error',
        error:
          'No configured providers found. Configure at least one provider ' +
          '(anthropic, openai, openrouter, or a custom openai-compatible endpoint) to list models.',
      };
    }

    // Fetch models from each provider
    const allModels: ModelInfo[] = [];
    const errors: string[] = [];

    for (const providerName of providersToQuery) {
      try {
        const entry = config.getProviderConfig(providerName);
        const builtins = ['anthropic', 'openai', 'openrouter'];
        const adapterType =
          entry?.type ??
          entry?.provider ??
          (builtins.includes(providerName) ? providerName : 'openai-compatible');
        const isLocalCompatible = adapterType === 'openai-compatible';

        const apiKey = config.resolveApiKey(providerName);
        if (!apiKey && !isLocalCompatible) {
          errors.push(`${providerName}: no API key configured`);
          continue;
        }

        const providerConfig: ProviderConfig = {
          type: adapterType,
          name: providerName,
          provider: adapterType,
          apiKey: apiKey ?? 'local',
          baseUrl: entry?.baseUrl,
          defaultModel: entry?.defaultModel,
          models: entry?.models,
        };

        const providerInstance = createProvider(providerConfig);
        if (!providerInstance.listModels) {
          errors.push(`${providerName}: listModels not supported`);
          continue;
        }

        // Fetch full list from provider (provider handles its own cache)
        // We pass category through for OpenRouter but apply search/sort/pagination ourselves
        const result = await providerInstance.listModels({
          category,
          // Get all models — we'll sort/filter globally
          limit: 10_000,
          offset: 0,
        });

        allModels.push(...result.models);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${providerName}: ${msg}`);
      }
    }

    if (allModels.length === 0 && errors.length > 0) {
      return {
        status: 'error',
        error: `Failed to fetch models: ${errors.join('; ')}`,
      };
    }

    // Apply global search/sort/pagination
    const result = filterAndPaginateModels(allModels, {
      search,
      sortBy,
      sortOrder,
      limit,
      offset,
    });

    // Format output
    if (format === 'json') {
      const output: Record<string, unknown> = {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        models: result.models,
      };
      if (errors.length > 0) {
        output.warnings = errors;
      }
      return {
        status: 'success',
        data: JSON.stringify(output, null, 2),
      };
    }

    // Compact format
    let output = formatModelsCompact(result);
    if (errors.length > 0) {
      output += `\n\nWarnings: ${errors.join('; ')}`;
    }

    return {
      status: 'success',
      data: output,
    };
  },
};

// ============================================================
// list_providers — enumerate all configured LLM providers
// ============================================================

export const listProvidersTool: Tool = {
  name: 'list_providers',
  description:
    'List all LLM providers configured in this workspace. ' +
    'Returns each provider\'s name, adapter type, base URL, default model, ' +
    'and whether an API key is available. ' +
    'Use this to discover valid provider names when creating or modifying agents.',

  parameters: {
    type: 'object',
    properties: {},
    required: [],
  } as JSONSchema,

  async execute(_args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const merged = context.config.getMerged();
    const storedProviders = merged.providers ?? {};

    // Start from all explicitly stored provider entries
    const entries = Object.entries(storedProviders).map(([name, cfg]) => ({
      name,
      type: cfg.type ?? cfg.provider ?? 'openai-compatible',
      baseUrl: cfg.baseUrl ?? (name === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined),
      defaultModel: cfg.defaultModel,
      hasApiKey: !!(context.config.resolveApiKey(name)),
    }));

    // Always surface the three built-in providers even if not explicitly configured,
    // so agents know they exist and can check whether a key is available.
    const builtins = ['anthropic', 'openai', 'openrouter'];
    for (const name of builtins) {
      if (!storedProviders[name]) {
        entries.push({
          name,
          type: name,
          baseUrl: name === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined,
          defaultModel: undefined,
          hasApiKey: !!(context.config.resolveApiKey(name)),
        });
      }
    }

    return {
      status: 'success',
      data: JSON.stringify({ providers: entries }, null, 2),
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
  listModelsTool,
  listProvidersTool,
];
