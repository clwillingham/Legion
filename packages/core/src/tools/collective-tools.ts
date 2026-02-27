import type { Tool, ToolResult, JSONSchema } from './Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';
import type { AgentConfig, UserConfig } from '../collective/Participant.js';
import type { Message } from '../communication/Message.js';
import { Session } from '../communication/Session.js';

/**
 * collective-tools — tools for querying the collective, sessions, conversations, and models.
 *
 * These tools allow agents to explore the system state: who's available,
 * what sessions/conversations exist, what models are configured, and
 * what was said in past conversations.
 */

// ============================================================
// list_participants — list all active participants
// ============================================================

export const listParticipantsTool: Tool = {
  name: 'list_participants',
  description:
    'List all active participants in the collective. ' +
    'Returns their IDs, names, types, and descriptions. ' +
    'Optionally filter by type (agent, user, mock).',

  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['agent', 'user', 'mock'],
        description: 'Optional filter by participant type.',
      },
      includeRetired: {
        type: 'boolean',
        description: 'Whether to include retired participants. Defaults to false.',
      },
    },
    required: [],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const { type: typeFilter, includeRetired } = args as {
      type?: string;
      includeRetired?: boolean;
    };

    const collective = context.session.collective;
    const statusFilter = includeRetired ? undefined : 'active';
    const participants = collective.list({ type: typeFilter, status: statusFilter });

    const summary = participants.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      description: p.description,
      status: p.status,
      ...(p.type === 'agent'
        ? { model: `${(p as AgentConfig).model.provider}/${(p as AgentConfig).model.model}` }
        : {}),
      ...(p.type === 'user'
        ? { medium: (p as UserConfig).medium.type }
        : {}),
    }));

    return {
      status: 'success',
      data: JSON.stringify(summary, null, 2),
    };
  },
};

// ============================================================
// get_participant — get detailed info about a specific participant
// ============================================================

export const getParticipantTool: Tool = {
  name: 'get_participant',
  description:
    'Get detailed information about a specific participant by ID. ' +
    'Returns their full configuration including tools, model, and system prompt.',

  parameters: {
    type: 'object',
    properties: {
      participantId: {
        type: 'string',
        description: 'The ID of the participant to look up.',
      },
    },
    required: ['participantId'],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const { participantId } = args as { participantId: string };

    if (!participantId) {
      return { status: 'error', error: 'participantId is required.' };
    }

    const collective = context.session.collective;
    const participant = collective.get(participantId);

    if (!participant) {
      return { status: 'error', error: `Participant not found: ${participantId}` };
    }

    return {
      status: 'success',
      data: JSON.stringify(participant, null, 2),
    };
  },
};

// ============================================================
// list_sessions — list sessions (active, ended, or all)
// ============================================================

export const listSessionsTool: Tool = {
  name: 'list_sessions',
  description:
    'List all sessions. Returns session IDs, names, status, and creation time. ' +
    'The current session is always included.',

  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'ended', 'all'],
        description: 'Filter by session status. Defaults to "all".',
      },
    },
    required: [],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const { status: statusFilter } = args as { status?: string };

    const currentSession = context.session;
    const currentId = currentSession.data.id;

    // Load all sessions from disk
    const filter = statusFilter && statusFilter !== 'all'
      ? { status: statusFilter as 'active' | 'ended' }
      : undefined;
    const allSessions = await Session.listAll(context.storage, filter);

    // Ensure current session is present (it may not be persisted yet)
    const hasCurrentInList = allSessions.some((s) => s.id === currentId);

    const result = allSessions.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      createdAt: s.createdAt,
      isCurrent: s.id === currentId,
    }));

    if (!hasCurrentInList) {
      const currentData = currentSession.data;
      if (!statusFilter || statusFilter === 'all' || statusFilter === currentData.status) {
        result.unshift({
          id: currentData.id,
          name: currentData.name,
          status: currentData.status,
          createdAt: currentData.createdAt,
          isCurrent: true,
        });
      }
    }

    return {
      status: 'success',
      data: JSON.stringify(result, null, 2),
    };
  },
};

// ============================================================
// list_conversations — list conversations within current session
// ============================================================

export const listConversationsTool: Tool = {
  name: 'list_conversations',
  description:
    'List all conversations in the current session. ' +
    'Returns the initiator, target, optional name, message count, and creation time. ' +
    'Optionally filter to only conversations involving a specific participant.',

  parameters: {
    type: 'object',
    properties: {
      participantId: {
        type: 'string',
        description:
          'Optional: only show conversations involving this participant.',
      },
    },
    required: [],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const { participantId } = args as { participantId?: string };

    const session = context.session;
    const conversations = participantId
      ? session.listConversationsFor(participantId)
      : session.listConversations();

    const summary = conversations.map((c) => ({
      initiator: c.data.initiatorId,
      target: c.data.targetId,
      name: c.data.name ?? '(default)',
      messageCount: c.data.messages.length,
      createdAt: c.data.createdAt,
    }));

    return {
      status: 'success',
      data: JSON.stringify(summary, null, 2),
    };
  },
};

// ============================================================
// list_models — list available/configured models
// ============================================================

export const listModelsTool: Tool = {
  name: 'list_models',
  description:
    'List all configured LLM providers and models. ' +
    'Shows which providers have API keys configured and what models agents are using.',

  parameters: {
    type: 'object',
    properties: {},
    required: [],
  } as JSONSchema,

  async execute(_args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const config = context.config;
    const collective = context.session.collective;

    // Gather provider configuration
    const providers = config.get('providers') ?? {};
    const providerInfo = Object.entries(providers).map(([name, conf]) => ({
      provider: name,
      hasApiKey: !!(conf.apiKey || config.resolveApiKey(name)),
      baseUrl: conf.baseUrl,
      defaultModel: conf.defaultModel,
    }));

    // Also check standard env vars for providers not explicitly configured
    const standardProviders = ['anthropic', 'openai', 'openrouter'] as const;
    for (const name of standardProviders) {
      if (!providerInfo.some((p) => p.provider === name)) {
        const apiKey = config.resolveApiKey(name);
        if (apiKey) {
          providerInfo.push({
            provider: name,
            hasApiKey: true,
            baseUrl: undefined,
            defaultModel: undefined,
          });
        }
      }
    }

    // Gather models actively used by agents
    const agents = collective.list({ type: 'agent', status: 'active' }) as AgentConfig[];
    const activeModels = agents.map((a) => ({
      agentId: a.id,
      agentName: a.name,
      provider: a.model.provider,
      model: a.model.model,
    }));

    return {
      status: 'success',
      data: JSON.stringify({ providers: providerInfo, activeModels }, null, 2),
    };
  },
};

// ============================================================
// search_history — search conversation history in current session
// ============================================================

export const searchHistoryTool: Tool = {
  name: 'search_history',
  description:
    'Search conversation history in the current session. ' +
    'Searches message content for a text query. ' +
    'Returns matching messages with their conversation context.',

  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The text to search for in message content (case-insensitive).',
      },
      participantId: {
        type: 'string',
        description: 'Optional: only search conversations involving this participant.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return. Defaults to 20.',
      },
    },
    required: ['query'],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const { query, participantId, maxResults = 20 } = args as {
      query: string;
      participantId?: string;
      maxResults?: number;
    };

    if (!query) {
      return { status: 'error', error: 'query is required.' };
    }

    const session = context.session;
    const conversations = participantId
      ? session.listConversationsFor(participantId)
      : session.listConversations();

    const queryLower = query.toLowerCase();
    const matches: Array<{
      conversation: { initiator: string; target: string; name: string };
      message: Message;
    }> = [];

    for (const conv of conversations) {
      for (const msg of conv.data.messages) {
        if (matches.length >= maxResults) break;

        if (msg.content.toLowerCase().includes(queryLower)) {
          matches.push({
            conversation: {
              initiator: conv.data.initiatorId,
              target: conv.data.targetId,
              name: conv.data.name ?? '(default)',
            },
            message: {
              role: msg.role,
              participantId: msg.participantId,
              timestamp: msg.timestamp,
              content:
                msg.content.length > 200
                  ? msg.content.slice(0, 200) + '...'
                  : msg.content,
            },
          });
        }
      }

      if (matches.length >= maxResults) break;
    }

    return {
      status: 'success',
      data: JSON.stringify(
        {
          query,
          totalResults: matches.length,
          results: matches,
        },
        null,
        2,
      ),
    };
  },
};

// ============================================================
// All collective/exploration tools bundled for easy registration
// ============================================================

export const collectiveTools: Tool[] = [
  listParticipantsTool,
  getParticipantTool,
  listSessionsTool,
  listConversationsTool,
  listModelsTool,
  searchHistoryTool,
];
