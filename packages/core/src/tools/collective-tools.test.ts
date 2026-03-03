/**
 * Tests for collective-tools — list_participants, get_participant,
 * list_sessions, list_conversations, inspect_session, search_history.
 *
 * Uses minimal stubs for Session, Collective, Conversation, and Storage
 * since these tools are essentially query/read operations against in-memory
 * data structures.
 */

import {
  listParticipantsTool,
  getParticipantTool,
  listConversationsTool,
  inspectSessionTool,
  searchHistoryTool,
} from './collective-tools.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';
import type { AgentConfig, UserConfig, MockConfig } from '../collective/Participant.js';
import type { Message } from '../communication/Message.js';

// ── Test data ──────────────────────────────────────────────────

const agentParticipant: AgentConfig = {
  id: 'agent-1',
  type: 'agent',
  name: 'Test Agent',
  description: 'A test agent',
  tools: { file_read: { mode: 'auto' }, file_write: { mode: 'requires_approval' } },
  approvalAuthority: {},
  status: 'active',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  systemPrompt: 'You are a test agent.',
  createdBy: 'user-chris',
  createdAt: '2026-01-01T00:00:00Z',
};

const userParticipant: UserConfig = {
  id: 'user-chris',
  type: 'user',
  name: 'Chris',
  description: 'The user',
  tools: {},
  approvalAuthority: '*',
  status: 'active',
  medium: { type: 'repl' },
};

const retiredAgent: AgentConfig = {
  id: 'agent-retired',
  type: 'agent',
  name: 'Old Agent',
  description: 'A retired agent',
  tools: {},
  approvalAuthority: {},
  status: 'retired',
  model: { provider: 'openai', model: 'gpt-4o' },
  systemPrompt: 'You used to be useful.',
  createdBy: 'user-chris',
  createdAt: '2025-12-01T00:00:00Z',
};

const mockParticipant: MockConfig = {
  id: 'mock-1',
  type: 'mock',
  name: 'Mock Bot',
  description: 'A mock participant for testing',
  tools: {},
  approvalAuthority: {},
  status: 'active',
  responses: [{ trigger: '*', response: 'mock reply' }],
};

const allParticipants = [agentParticipant, userParticipant, retiredAgent, mockParticipant];

// ── Stub messages ───────────────────────────────────────────────

function makeMessage(
  role: 'user' | 'assistant',
  participantId: string,
  content: string,
  extra?: { toolCalls?: Message['toolCalls']; toolResults?: Message['toolResults'] },
): Message {
  return {
    role,
    participantId,
    timestamp: new Date().toISOString(),
    content,
    ...extra,
  };
}

const conversationMessages: Message[] = [
  makeMessage('user', 'user-chris', 'Hello, can you help me?'),
  makeMessage('assistant', 'agent-1', 'Of course! What do you need?'),
  makeMessage('user', 'user-chris', 'Please refactor the auth module.'),
  makeMessage('assistant', 'agent-1', 'I will start by reading the files.', {
    toolCalls: [{ id: 'tc-1', tool: 'file_read', args: { path: 'src/auth.ts' } }],
    toolResults: [{ toolCallId: 'tc-1', tool: 'file_read', status: 'success', result: 'file contents' }],
  }),
  makeMessage('user', 'user-chris', 'Great, thanks!'),
];

const secondConvoMessages: Message[] = [
  makeMessage('user', 'agent-1', 'Can you review the auth implementation?'),
  makeMessage('assistant', 'mock-1', 'Looks good to me.'),
];

// ── Stub factories ──────────────────────────────────────────────

function createStubConversation(
  initiatorId: string,
  targetId: string,
  messages: Message[],
  name?: string,
) {
  return {
    data: {
      sessionId: 'test-session',
      initiatorId,
      targetId,
      name,
      messages,
      createdAt: '2026-03-01T00:00:00Z',
    },
  };
}

const defaultConvo = createStubConversation('user-chris', 'agent-1', conversationMessages);
const namedConvo = createStubConversation('user-chris', 'agent-1', [
  makeMessage('user', 'user-chris', 'Test named conversation'),
], 'auth-review');
const agentConvo = createStubConversation('agent-1', 'mock-1', secondConvoMessages);
const allConversations = [defaultConvo, namedConvo, agentConvo];

function createMockContext(
  overrides?: Partial<{
    participants: typeof allParticipants;
    conversations: typeof allConversations;
  }>,
): RuntimeContext {
  const participants = overrides?.participants ?? allParticipants;
  const conversations = overrides?.conversations ?? allConversations;

  return {
    session: {
      data: {
        id: 'test-session',
        name: 'Test Session',
        createdAt: '2026-03-01T00:00:00Z',
        status: 'active',
      },
      collective: {
        list: (filter?: { type?: string; status?: string }) => {
          let result = [...participants];
          if (filter?.type) result = result.filter((p) => p.type === filter.type);
          if (filter?.status) result = result.filter((p) => p.status === filter.status);
          return result;
        },
        get: (id: string) => participants.find((p) => p.id === id),
      },
      listConversations: () => conversations,
      listConversationsFor: (participantId: string) =>
        conversations.filter(
          (c) =>
            c.data.initiatorId === participantId || c.data.targetId === participantId,
        ),
    },
  } as unknown as RuntimeContext;
}

// ============================================================
// Tests
// ============================================================

describe('collective-tools', () => {
  const ctx = createMockContext();

  // ── list_participants ────────────────────────────────────────

  describe('list_participants', () => {
    it('lists active participants by default', async () => {
      const result = await listParticipantsTool.execute({}, ctx);
      expect(result.status).toBe('success');
      const data = JSON.parse(result.data as string);
      // Should exclude retired agent
      expect(data).toHaveLength(3);
      expect(data.map((p: Record<string, unknown>) => p.id)).toEqual([
        'agent-1',
        'user-chris',
        'mock-1',
      ]);
    });

    it('includes retired when requested', async () => {
      const result = await listParticipantsTool.execute(
        { includeRetired: true },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data).toHaveLength(4);
    });

    it('filters by type', async () => {
      const result = await listParticipantsTool.execute({ type: 'agent' }, ctx);
      const data = JSON.parse(result.data as string);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('agent-1');
    });

    it('filters by name substring', async () => {
      const result = await listParticipantsTool.execute({ name: 'chris' }, ctx);
      const data = JSON.parse(result.data as string);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('user-chris');
    });

    it('includes model info for agents', async () => {
      const result = await listParticipantsTool.execute({ type: 'agent' }, ctx);
      const data = JSON.parse(result.data as string);
      expect(data[0].model).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('includes medium for users', async () => {
      const result = await listParticipantsTool.execute({ type: 'user' }, ctx);
      const data = JSON.parse(result.data as string);
      expect(data[0].medium).toBe('repl');
    });
  });

  // ── get_participant ──────────────────────────────────────────

  describe('get_participant', () => {
    it('returns structured participant info', async () => {
      const result = await getParticipantTool.execute(
        { participantId: 'agent-1' },
        ctx,
      );
      expect(result.status).toBe('success');
      const data = JSON.parse(result.data as string);
      expect(data.id).toBe('agent-1');
      expect(data.type).toBe('agent');
      expect(data.name).toBe('Test Agent');
      expect(data.model.provider).toBe('anthropic');
      expect(data.systemPrompt).toBe('You are a test agent.');
      expect(data.createdBy).toBe('user-chris');
    });

    it('returns error for unknown participant', async () => {
      const result = await getParticipantTool.execute(
        { participantId: 'nonexistent' },
        ctx,
      );
      expect(result.status).toBe('error');
      expect(result.error).toContain('not found');
    });

    it('includes tool policies by default', async () => {
      const result = await getParticipantTool.execute(
        { participantId: 'agent-1' },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.tools).toBeDefined();
      expect(data.tools.file_read.mode).toBe('auto');
      expect(data.tools.file_write.mode).toBe('requires_approval');
    });

    it('excludes tool policies when requested', async () => {
      const result = await getParticipantTool.execute(
        { participantId: 'agent-1', includeToolPolicies: false },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.tools).toBeUndefined();
    });

    it('includes conversation activity when requested', async () => {
      const result = await getParticipantTool.execute(
        { participantId: 'agent-1', includeConversations: true },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.conversationCount).toBe(3);
      expect(data.conversations).toHaveLength(3);
      expect(data.conversations[0]).toHaveProperty('messageCount');
      expect(data.conversations[0]).toHaveProperty('lastActivity');
    });

    it('shows user participant with medium info', async () => {
      const result = await getParticipantTool.execute(
        { participantId: 'user-chris' },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.type).toBe('user');
      expect(data.medium.type).toBe('repl');
    });

    it('returns error when participantId is missing', async () => {
      const result = await getParticipantTool.execute({}, ctx);
      expect(result.status).toBe('error');
      expect(result.error).toContain('required');
    });
  });

  // ── list_conversations ───────────────────────────────────────

  describe('list_conversations', () => {
    it('lists all conversations', async () => {
      const result = await listConversationsTool.execute({}, ctx);
      expect(result.status).toBe('success');
      const data = JSON.parse(result.data as string);
      expect(data).toHaveLength(3);
    });

    it('filters by participant', async () => {
      const result = await listConversationsTool.execute(
        { participantId: 'mock-1' },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data).toHaveLength(1);
      expect(data[0].target).toBe('mock-1');
    });

    it('includes message counts', async () => {
      const result = await listConversationsTool.execute({}, ctx);
      const data = JSON.parse(result.data as string);
      const mainConvo = data.find(
        (c: Record<string, unknown>) => c.initiator === 'user-chris' && c.name === '(default)',
      );
      expect(mainConvo.messageCount).toBe(5);
    });
  });

  // ── inspect_session ──────────────────────────────────────────

  describe('inspect_session', () => {
    it('returns message history for a conversation', async () => {
      const result = await inspectSessionTool.execute(
        { initiator: 'user-chris', target: 'agent-1' },
        ctx,
      );
      expect(result.status).toBe('success');
      const data = JSON.parse(result.data as string);
      expect(data.totalMessages).toBe(5);
      expect(data.messages).toHaveLength(5);
      expect(data.conversation.initiator).toBe('user-chris');
      expect(data.conversation.target).toBe('agent-1');
    });

    it('supports pagination with offset and limit', async () => {
      const result = await inspectSessionTool.execute(
        { initiator: 'user-chris', target: 'agent-1', offset: 2, limit: 2 },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.returned).toBe(2);
      expect(data.hasMore).toBe(true);
      expect(data.messages[0].index).toBe(2);
      expect(data.messages[0].content).toContain('refactor');
    });

    it('reports hasMore correctly at the end', async () => {
      const result = await inspectSessionTool.execute(
        { initiator: 'user-chris', target: 'agent-1', offset: 4, limit: 10 },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.returned).toBe(1);
      expect(data.hasMore).toBe(false);
    });

    it('filters by role', async () => {
      const result = await inspectSessionTool.execute(
        { initiator: 'user-chris', target: 'agent-1', role: 'user' },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.totalMessages).toBe(3);
      expect(data.messages.every((m: Record<string, unknown>) => m.role === 'user')).toBe(true);
    });

    it('includes tool calls when requested', async () => {
      const result = await inspectSessionTool.execute(
        { initiator: 'user-chris', target: 'agent-1', includeToolCalls: true },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      const msgWithTools = data.messages.find(
        (m: Record<string, unknown>) =>
          (m.toolCalls as unknown[] | undefined)?.length,
      );
      expect(msgWithTools).toBeDefined();
      expect(msgWithTools.toolCalls[0].tool).toBe('file_read');
    });

    it('excludes tool calls by default', async () => {
      const result = await inspectSessionTool.execute(
        { initiator: 'user-chris', target: 'agent-1' },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      const hasToolCalls = data.messages.some(
        (m: Record<string, unknown>) => m.toolCalls !== undefined,
      );
      expect(hasToolCalls).toBe(false);
    });

    it('returns error for non-existent conversation', async () => {
      const result = await inspectSessionTool.execute(
        { initiator: 'user-chris', target: 'nonexistent' },
        ctx,
      );
      expect(result.status).toBe('error');
      expect(result.error).toContain('not found');
    });

    it('finds named conversations', async () => {
      const result = await inspectSessionTool.execute(
        { initiator: 'user-chris', target: 'agent-1', conversationName: 'auth-review' },
        ctx,
      );
      expect(result.status).toBe('success');
      const data = JSON.parse(result.data as string);
      expect(data.totalMessages).toBe(1);
      expect(data.conversation.name).toBe('auth-review');
    });

    it('returns error when required params are missing', async () => {
      const result = await inspectSessionTool.execute({ initiator: 'user-chris' }, ctx);
      expect(result.status).toBe('error');
      expect(result.error).toContain('required');
    });
  });

  // ── search_history ───────────────────────────────────────────

  describe('search_history', () => {
    it('finds messages by plain text query', async () => {
      const result = await searchHistoryTool.execute({ query: 'refactor' }, ctx);
      expect(result.status).toBe('success');
      const data = JSON.parse(result.data as string);
      expect(data.totalResults).toBe(1);
      expect(data.results[0].message.content).toContain('refactor');
    });

    it('search is case-insensitive', async () => {
      const result = await searchHistoryTool.execute({ query: 'HELLO' }, ctx);
      const data = JSON.parse(result.data as string);
      expect(data.totalResults).toBe(1);
    });

    it('searches across all conversations', async () => {
      const result = await searchHistoryTool.execute({ query: 'review' }, ctx);
      const data = JSON.parse(result.data as string);
      // Should find "review" in both the agent→mock conversation and auth-review named convo message
      expect(data.totalResults).toBeGreaterThanOrEqual(1);
    });

    it('filters by participant', async () => {
      const result = await searchHistoryTool.execute(
        { query: 'review', participantId: 'mock-1' },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      // Only conversations involving mock-1
      for (const r of data.results) {
        const conv = r.conversation;
        expect(
          conv.initiator === 'mock-1' || conv.target === 'mock-1',
        ).toBe(true);
      }
    });

    it('supports regex queries', async () => {
      const result = await searchHistoryTool.execute(
        { query: 'help|refactor', isRegex: true },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.totalResults).toBe(2);
      expect(data.isRegex).toBe(true);
    });

    it('returns error for invalid regex', async () => {
      const result = await searchHistoryTool.execute(
        { query: '[invalid', isRegex: true },
        ctx,
      );
      expect(result.status).toBe('error');
      expect(result.error).toContain('Invalid regex');
    });

    it('filters by role', async () => {
      const result = await searchHistoryTool.execute(
        { query: 'reading', role: 'assistant' },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      for (const r of data.results) {
        expect(r.message.role).toBe('assistant');
      }
    });

    it('includes context lines when requested', async () => {
      const result = await searchHistoryTool.execute(
        { query: 'refactor', contextLines: 1 },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.totalResults).toBe(1);
      const match = data.results[0];
      expect(match.contextBefore).toBeDefined();
      expect(match.contextBefore.length).toBe(1);
      expect(match.contextAfter).toBeDefined();
      expect(match.contextAfter.length).toBe(1);
    });

    it('context lines are bounded at conversation edges', async () => {
      // Search for the first message — no context before
      const result = await searchHistoryTool.execute(
        { query: 'Hello', contextLines: 3 },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      const match = data.results[0];
      expect(match.contextBefore).toHaveLength(0);
      expect(match.contextAfter.length).toBeGreaterThan(0);
    });

    it('caps context lines at 5', async () => {
      const result = await searchHistoryTool.execute(
        { query: 'refactor', contextLines: 100 },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      const match = data.results[0];
      // contextBefore + contextAfter should each be at most 5
      expect(match.contextBefore.length).toBeLessThanOrEqual(5);
      expect(match.contextAfter.length).toBeLessThanOrEqual(5);
    });

    it('includes messageIndex in results', async () => {
      const result = await searchHistoryTool.execute(
        { query: 'refactor' },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.results[0].messageIndex).toBe(2);
    });

    it('respects maxResults', async () => {
      const result = await searchHistoryTool.execute(
        { query: 'a', maxResults: 2 },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      expect(data.totalResults).toBeLessThanOrEqual(2);
    });

    it('returns error when query is missing', async () => {
      const result = await searchHistoryTool.execute({}, ctx);
      expect(result.status).toBe('error');
      expect(result.error).toContain('required');
    });

    it('omits context fields when contextLines is 0', async () => {
      const result = await searchHistoryTool.execute(
        { query: 'refactor', contextLines: 0 },
        ctx,
      );
      const data = JSON.parse(result.data as string);
      const match = data.results[0];
      expect(match.contextBefore).toBeUndefined();
      expect(match.contextAfter).toBeUndefined();
    });
  });
});
