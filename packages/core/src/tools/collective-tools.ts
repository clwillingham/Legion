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
      name: {
        type: 'string',
        description: 'Optional filter by participant name (case-insensitive substring match).',
      },
      includeRetired: {
        type: 'boolean',
        description: 'Whether to include retired participants. Defaults to false.',
      },
      includeSystemPrompt: {
        type: 'boolean',
        description: 'Whether to include the system prompt for each participant. Defaults to false.',
      },
    },
    required: [],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const { type: typeFilter, includeRetired, includeSystemPrompt, name } = args as {
      type?: string;
      includeRetired?: boolean;
      includeSystemPrompt?: boolean;
      name?: string;
    };

    const collective = context.session.collective;
    const statusFilter = includeRetired ? undefined : 'active';
    const participants = collective.list({ type: typeFilter, status: statusFilter });

    const summary = participants
        .filter(p => !name || p.name.toLowerCase().includes(name.toLowerCase()))
        .map((p) => ({
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
      ...(includeSystemPrompt && p.type === 'agent'
        ? { systemPrompt: (p as AgentConfig).systemPrompt }
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
    'Returns their full configuration including tools, model, and system prompt. ' +
    'Optionally includes conversation activity summary (conversations they are in, ' +
    'message counts, last activity timestamps).',

  parameters: {
    type: 'object',
    properties: {
      participantId: {
        type: 'string',
        description: 'The ID of the participant to look up.',
      },
      includeConversations: {
        type: 'boolean',
        description:
          'Whether to include a summary of conversations this participant is involved in. ' +
          'Shows initiator, target, message count, and last activity time. Defaults to false.',
      },
      includeToolPolicies: {
        type: 'boolean',
        description:
          'Whether to include the full tool policy map. Defaults to true.',
      },
    },
    required: ['participantId'],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const {
      participantId,
      includeConversations = false,
      includeToolPolicies = true,
    } = args as {
      participantId: string;
      includeConversations?: boolean;
      includeToolPolicies?: boolean;
    };

    if (!participantId) {
      return { status: 'error', error: 'participantId is required.' };
    }

    const collective = context.session.collective;
    const participant = collective.get(participantId);

    if (!participant) {
      return { status: 'error', error: `Participant not found: ${participantId}` };
    }

    // Build the result object — structured rather than raw JSON dump
    const result: Record<string, unknown> = {
      id: participant.id,
      type: participant.type,
      name: participant.name,
      description: participant.description,
      status: participant.status,
    };

    // Type-specific fields
    if (participant.type === 'agent') {
      const agent = participant as AgentConfig;
      result.model = agent.model;
      result.systemPrompt = agent.systemPrompt;
      result.createdBy = agent.createdBy;
      result.createdAt = agent.createdAt;
      if (agent.runtimeConfig) {
        result.runtimeConfig = agent.runtimeConfig;
      }
    } else if (participant.type === 'user') {
      result.medium = (participant as UserConfig).medium;
    }

    // Tool policies
    if (includeToolPolicies) {
      const tools = participant.tools;
      const toolNames = Object.keys(tools);
      result.tools = tools;
      result.toolCount = toolNames.length === 0 && participant.tools
        ? '* (wildcard — all tools)'
        : toolNames.length;
    }

    // Approval authority
    result.approvalAuthority = participant.approvalAuthority;

    // Conversation activity summary
    if (includeConversations) {
      const conversations = context.session.listConversationsFor(participantId);
      result.conversations = conversations.map((c) => {
        const msgs = c.data.messages;
        const lastMessage = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        return {
          initiator: c.data.initiatorId,
          target: c.data.targetId,
          name: c.data.name ?? '(default)',
          messageCount: msgs.length,
          lastActivity: lastMessage?.timestamp ?? c.data.createdAt,
          lastRole: lastMessage?.role ?? null,
        };
      });
      result.conversationCount = conversations.length;
    }

    return {
      status: 'success',
      data: JSON.stringify(result, null, 2),
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
// inspect_session — view conversation message history
// ============================================================

export const inspectSessionTool: Tool = {
  name: 'inspect_session',
  description:
    'View the message history of a specific conversation within the current session. ' +
    'Specify the initiator and target participant IDs (and optional conversation name) ' +
    'to retrieve messages. Supports pagination via offset/limit for long conversations.',

  parameters: {
    type: 'object',
    properties: {
      initiator: {
        type: 'string',
        description: 'The initiator participant ID of the conversation.',
      },
      target: {
        type: 'string',
        description: 'The target participant ID of the conversation.',
      },
      conversationName: {
        type: 'string',
        description:
          'Optional named conversation. Omit for the default conversation between these participants.',
      },
      offset: {
        type: 'number',
        description:
          'Starting message index (0-based). Use for pagination. Defaults to 0.',
      },
      limit: {
        type: 'number',
        description:
          'Maximum number of messages to return. Defaults to 50.',
      },
      role: {
        type: 'string',
        enum: ['user', 'assistant'],
        description:
          'Optional filter: only return messages from this role.',
      },
      includeToolCalls: {
        type: 'boolean',
        description:
          'Whether to include tool call details in messages. Defaults to false ' +
          '(only shows text content for readability).',
      },
    },
    required: ['initiator', 'target'],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const {
      initiator,
      target,
      conversationName,
      offset = 0,
      limit = 50,
      role: roleFilter,
      includeToolCalls = false,
    } = args as {
      initiator: string;
      target: string;
      conversationName?: string;
      offset?: number;
      limit?: number;
      role?: 'user' | 'assistant';
      includeToolCalls?: boolean;
    };

    if (!initiator || !target) {
      return { status: 'error', error: 'Both initiator and target are required.' };
    }

    // Find the matching conversation in the current session
    const conversations = context.session.listConversations();
    const conversation = conversations.find((c) => {
      const matchesParticipants =
        c.data.initiatorId === initiator && c.data.targetId === target;
      const matchesName = conversationName
        ? c.data.name === conversationName
        : !c.data.name;
      return matchesParticipants && matchesName;
    });

    if (!conversation) {
      const nameDesc = conversationName ? ` (name: "${conversationName}")` : '';
      return {
        status: 'error',
        error: `Conversation not found: ${initiator} → ${target}${nameDesc}`,
      };
    }

    // Filter by role if specified
    let messages = conversation.data.messages;
    if (roleFilter) {
      messages = messages.filter((m) => m.role === roleFilter);
    }

    const totalMessages = messages.length;

    // Apply pagination
    const paginated = messages.slice(offset, offset + limit);

    // Format messages
    const formattedMessages = paginated.map((m, i) => {
      const entry: Record<string, unknown> = {
        index: offset + i,
        role: m.role,
        participantId: m.participantId,
        timestamp: m.timestamp,
        content:
          m.content.length > 500
            ? m.content.slice(0, 500) + '...'
            : m.content,
      };
      if (includeToolCalls && m.toolCalls && m.toolCalls.length > 0) {
        entry.toolCalls = m.toolCalls.map((tc) => ({
          id: tc.id,
          tool: tc.tool,
          args: tc.args,
        }));
      }
      if (includeToolCalls && m.toolResults && m.toolResults.length > 0) {
        entry.toolResults = m.toolResults.map((tr) => ({
          toolCallId: tr.toolCallId,
          status: tr.status,
        }));
      }
      return entry;
    });

    return {
      status: 'success',
      data: JSON.stringify(
        {
          conversation: {
            initiator: conversation.data.initiatorId,
            target: conversation.data.targetId,
            name: conversation.data.name ?? '(default)',
            createdAt: conversation.data.createdAt,
          },
          totalMessages,
          offset,
          limit,
          returned: formattedMessages.length,
          hasMore: offset + limit < totalMessages,
          messages: formattedMessages,
        },
        null,
        2,
      ),
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
    'Searches message content for a text or regex query. ' +
    'Returns matching messages with their conversation context. ' +
    'Supports filtering by role, participant, and including surrounding context messages.',

  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'The text or regex pattern to search for in message content. ' +
          'Case-insensitive by default.',
      },
      isRegex: {
        type: 'boolean',
        description:
          'Whether the query is a regular expression. Defaults to false (plain text substring search).',
      },
      participantId: {
        type: 'string',
        description: 'Optional: only search conversations involving this participant.',
      },
      role: {
        type: 'string',
        enum: ['user', 'assistant'],
        description: 'Optional: only match messages from this role.',
      },
      contextLines: {
        type: 'number',
        description:
          'Number of surrounding messages (before and after) to include with each match. ' +
          'Defaults to 0 (no context). Max 5.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of matching messages to return. Defaults to 20.',
      },
    },
    required: ['query'],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const {
      query,
      isRegex = false,
      participantId,
      role: roleFilter,
      contextLines: rawContextLines = 0,
      maxResults = 20,
    } = args as {
      query: string;
      isRegex?: boolean;
      participantId?: string;
      role?: 'user' | 'assistant';
      contextLines?: number;
      maxResults?: number;
    };

    if (!query) {
      return { status: 'error', error: 'query is required.' };
    }

    // Build the matcher
    let matcher: (text: string) => boolean;
    if (isRegex) {
      try {
        const regex = new RegExp(query, 'i');
        matcher = (text: string) => regex.test(text);
      } catch (err) {
        return {
          status: 'error',
          error: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    } else {
      const queryLower = query.toLowerCase();
      matcher = (text: string) => text.toLowerCase().includes(queryLower);
    }

    const contextCount = Math.min(Math.max(rawContextLines, 0), 5);

    const session = context.session;
    const conversations = participantId
      ? session.listConversationsFor(participantId)
      : session.listConversations();

    interface MatchResult {
      conversation: { initiator: string; target: string; name: string };
      messageIndex: number;
      message: Partial<Message>;
      contextBefore?: Array<Partial<Message>>;
      contextAfter?: Array<Partial<Message>>;
    }

    const matches: MatchResult[] = [];

    const truncateContent = (content: string): string =>
      content.length > 300 ? content.slice(0, 300) + '...' : content;

    const formatMessage = (msg: Message): Partial<Message> => ({
      role: msg.role,
      participantId: msg.participantId,
      timestamp: msg.timestamp,
      content: truncateContent(msg.content),
    });

    for (const conv of conversations) {
      const msgs = conv.data.messages;

      for (let i = 0; i < msgs.length; i++) {
        if (matches.length >= maxResults) break;

        const msg = msgs[i];

        // Apply role filter
        if (roleFilter && msg.role !== roleFilter) continue;

        // Apply content matcher
        if (!matcher(msg.content)) continue;

        const result: MatchResult = {
          conversation: {
            initiator: conv.data.initiatorId,
            target: conv.data.targetId,
            name: conv.data.name ?? '(default)',
          },
          messageIndex: i,
          message: formatMessage(msg),
        };

        // Add context messages
        if (contextCount > 0) {
          const beforeStart = Math.max(0, i - contextCount);
          result.contextBefore = msgs
            .slice(beforeStart, i)
            .map(formatMessage);

          const afterEnd = Math.min(msgs.length, i + 1 + contextCount);
          result.contextAfter = msgs
            .slice(i + 1, afterEnd)
            .map(formatMessage);
        }

        matches.push(result);
      }

      if (matches.length >= maxResults) break;
    }

    return {
      status: 'success',
      data: JSON.stringify(
        {
          query,
          isRegex,
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
  inspectSessionTool,
  searchHistoryTool,
];
