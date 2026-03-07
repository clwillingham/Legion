/**
 * Tests for AgentRuntime message persistence.
 *
 * Verifies that the agentic loop appends all intermediate messages
 * (assistant messages with tool calls, tool result messages, and the
 * final text response) to the Conversation via appendMessage(), which
 * persists them to disk.
 */

import { tmpdir } from 'node:os';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Session } from '../communication/Session.js';
import { Collective } from '../collective/Collective.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { RuntimeRegistry } from './RuntimeRegistry.js';
import { AgentRuntime } from './AgentRuntime.js';
import { AuthEngine } from '../authorization/AuthEngine.js';
import { PendingApprovalRegistry } from '../authorization/PendingApprovalRegistry.js';
import { EventBus } from '../events/EventBus.js';
import { Storage } from '../workspace/Storage.js';
import type { AgentConfig, MockConfig, AnyParticipantConfig } from '../collective/Participant.js';
import type { LLMProvider, ChatOptions, ChatResponse } from '../providers/Provider.js';
import type { Message } from '../communication/Message.js';
import type { RuntimeContext } from './ParticipantRuntime.js';
import type { ConversationData } from '../communication/Conversation.js';
import type { ToolCallResult } from '../tools/Tool.js';

// ── Scripted LLM provider ───────────────────────────────────────────────────

type ResponseFn = (messages: Message[]) => ChatResponse;

class ScriptedProvider implements LLMProvider {
  readonly name = 'scripted';
  private queue: Array<ChatResponse | ResponseFn>;
  readonly calls: Array<Message[]> = [];

  constructor(responses: Array<ChatResponse | ResponseFn>) {
    this.queue = [...responses];
  }

  async chat(messages: Message[], _opts: ChatOptions): Promise<ChatResponse> {
    this.calls.push([...messages]);
    const next = this.queue.shift();
    if (!next)
      throw new Error(`ScriptedProvider: no more responses (received ${messages.length} messages)`);
    return typeof next === 'function' ? next(messages) : next;
  }

  async listModels() {
    return { models: [], total: 0, limit: 0, offset: 0 };
  }
}

function toolCallResponse(
  tools: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
): ChatResponse {
  return {
    content: '',
    toolCalls: tools,
    finishReason: 'tool_use',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

function textResponse(content: string): ChatResponse {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

// ── Injectable AgentRuntime ─────────────────────────────────────────────────

class TestAgentRuntime extends AgentRuntime {
  constructor(private providerMap: Map<string, ScriptedProvider>) {
    super();
  }

  protected createProvider(agentConfig: AgentConfig, _context: RuntimeContext): LLMProvider {
    const p = this.providerMap.get(agentConfig.id);
    if (!p) throw new Error(`No scripted provider for agent: ${agentConfig.id}`);
    return p;
  }
}

// ── Participant fixtures ────────────────────────────────────────────────────

const userParticipant: MockConfig = {
  id: 'user',
  type: 'mock',
  name: 'User',
  description: 'Test user',
  tools: {},
  approvalAuthority: '*',
  status: 'active',
  responses: [{ trigger: '*', response: 'ok' }],
};

const testAgent: AgentConfig = {
  id: 'test-agent',
  type: 'agent',
  name: 'Test Agent',
  description: 'Agent for testing persistence',
  systemPrompt: 'You are a test agent.',
  model: { provider: 'scripted', model: 'test-model' },
  tools: {
    echo: { mode: 'auto' },
    failing_echo: { mode: 'auto' },
  },
  approvalAuthority: {},
  status: 'active',
  createdBy: 'system',
  createdAt: '2026-01-01T00:00:00Z',
};

// ── Test helpers ────────────────────────────────────────────────────────────

interface Harness {
  session: Session;
  provider: ScriptedProvider;
  tmpDir: string;
  storage: Storage;
  baseContext: RuntimeContext;
}

async function buildHarness(provider: ScriptedProvider): Promise<Harness> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'legion-agent-persist-'));
  const storage = new Storage(join(tmpDir, '.legion'));

  const collective = new Collective(storage);
  collective.loadFromArray([userParticipant, testAgent]);

  const toolRegistry = new ToolRegistry();
  toolRegistry.register({
    name: 'echo',
    description: 'Echo the input back',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    async execute(args) {
      const { text } = args as { text: string };
      return { status: 'success', data: `Echo: ${text}` };
    },
  });

  toolRegistry.register({
    name: 'failing_echo',
    description: 'Echo tool that always errors',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    async execute() {
      return { status: 'error', error: 'Something went wrong' };
    },
  });

  const authEngine = new AuthEngine({});
  const registry = new PendingApprovalRegistry();
  const eventBus = new EventBus();

  const providerMap = new Map<string, ScriptedProvider>([['test-agent', provider]]);

  const runtimeRegistry = new RuntimeRegistry();
  const testAgentRuntime = new TestAgentRuntime(providerMap);
  runtimeRegistry.register('agent', () => testAgentRuntime);

  // Minimal mock runtime for user type
  const { MockRuntime } = await import('./MockRuntime.js');
  runtimeRegistry.register('mock', () => new MockRuntime());

  const config = {
    get: () => undefined,
    resolveApiKey: () => 'test-key',
    getProviderConfig: () => undefined,
    load: async () => {},
  } as unknown as RuntimeContext['config'];

  const session = Session.create('test-session', storage, runtimeRegistry, collective, eventBus);

  const baseContext: RuntimeContext = {
    participant: userParticipant as unknown as RuntimeContext['participant'],
    conversation: null as unknown as RuntimeContext['conversation'],
    session,
    communicationDepth: 0,
    toolRegistry,
    config,
    eventBus,
    storage,
    authEngine,
    pendingApprovalRegistry: registry,
    callingParticipantId: undefined,
  };

  // Patch session.send to inject full context
  const originalSend = session.send.bind(session);
  (session as unknown as Record<string, unknown>).send = (
    initiatorId: string,
    targetId: string,
    message: string,
    name: string | undefined,
    ctx: RuntimeContext,
  ) => originalSend(initiatorId, targetId, message, name, { ...baseContext, ...ctx });

  return { session, provider, tmpDir, storage, baseContext };
}

async function cleanHarness(harness: Harness) {
  await rm(harness.tmpDir, { recursive: true, force: true });
}

/**
 * Read the persisted conversation file and return its messages.
 */
async function readPersistedConversation(harness: Harness): Promise<ConversationData> {
  // Conversation files are in .legion/sessions/{sessionId}/conversations/
  const sessionId = harness.session.data.id;
  const conversationsDir = resolve(
    harness.tmpDir,
    '.legion',
    'sessions',
    sessionId,
    'conversations',
  );
  const files = await import('node:fs/promises').then((fs) => fs.readdir(conversationsDir));
  const convFile = files.find((f) => f.endsWith('.json'));
  if (!convFile) throw new Error('No conversation file found on disk');

  const raw = await readFile(join(conversationsDir, convFile), 'utf-8');
  return JSON.parse(raw) as ConversationData;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AgentRuntime message persistence', () => {
  let harness: Harness;

  afterEach(async () => {
    if (harness) {
      await cleanHarness(harness);
    }
  });

  it('persists all intermediate messages to disk after a tool call round-trip', async () => {
    // Scenario: agent makes one tool call (echo), then produces a final text response.
    // Expected conversation on disk:
    //   1. user message
    //   2. assistant message with toolCalls
    //   3. user message with toolResults (tool result)
    //   4. assistant message (final text response)
    const provider = new ScriptedProvider([
      toolCallResponse([{ id: 'tc-1', name: 'echo', arguments: { text: 'hello world' } }]),
      textResponse('The echo said: hello world'),
    ]);

    harness = await buildHarness(provider);

    const result = await (
      harness.session as unknown as {
        send(
          a: string,
          b: string,
          c: string,
          d: undefined,
          ctx: Partial<RuntimeContext>,
        ): Promise<{ status: string; response?: string; messagesPersisted?: boolean }>;
      }
    ).send('user', 'test-agent', 'Please echo hello world', undefined, {
      communicationDepth: 0,
    });

    // Verify the runtime result
    expect(result.status).toBe('success');
    expect(result.response).toBe('The echo said: hello world');
    expect(result.messagesPersisted).toBe(true);

    // Read the persisted conversation file from disk
    const convData = await readPersistedConversation(harness);

    // Should have exactly 4 messages
    expect(convData.messages).toHaveLength(4);

    // 1. User message
    expect(convData.messages[0].role).toBe('user');
    expect(convData.messages[0].content).toBe('Please echo hello world');
    expect(convData.messages[0].participantId).toBe('user');

    // 2. Assistant message with tool calls
    expect(convData.messages[1].role).toBe('assistant');
    expect(convData.messages[1].participantId).toBe('test-agent');
    expect(convData.messages[1].toolCalls).toBeDefined();
    expect(convData.messages[1].toolCalls).toHaveLength(1);
    expect(convData.messages[1].toolCalls![0].tool).toBe('echo');
    expect(convData.messages[1].toolCalls![0].id).toBe('tc-1');

    // 3. Tool result message
    expect(convData.messages[2].role).toBe('user');
    expect(convData.messages[2].participantId).toBe('test-agent');
    expect(convData.messages[2].toolResults).toBeDefined();
    expect(convData.messages[2].toolResults).toHaveLength(1);
    expect(convData.messages[2].toolResults![0].toolCallId).toBe('tc-1');
    expect(convData.messages[2].toolResults![0].tool).toBe('echo');
    expect(convData.messages[2].toolResults![0].status).toBe('success');
    expect(convData.messages[2].toolResults![0].result).toContain('Echo: hello world');

    // 4. Final assistant response
    expect(convData.messages[3].role).toBe('assistant');
    expect(convData.messages[3].participantId).toBe('test-agent');
    expect(convData.messages[3].content).toBe('The echo said: hello world');
    expect(convData.messages[3].toolCalls).toBeUndefined();
  });

  it('persists messages for multiple tool call iterations', async () => {
    // Scenario: agent calls echo twice (two iterations), then produces text.
    // Expected: user, assistant(tc), toolResult, assistant(tc), toolResult, assistant(text)
    const provider = new ScriptedProvider([
      toolCallResponse([{ id: 'tc-1', name: 'echo', arguments: { text: 'first' } }]),
      toolCallResponse([{ id: 'tc-2', name: 'echo', arguments: { text: 'second' } }]),
      textResponse('Done with both calls'),
    ]);

    harness = await buildHarness(provider);

    const result = await (
      harness.session as unknown as {
        send(
          a: string,
          b: string,
          c: string,
          d: undefined,
          ctx: Partial<RuntimeContext>,
        ): Promise<{ status: string; response?: string }>;
      }
    ).send('user', 'test-agent', 'Do two echoes', undefined, {
      communicationDepth: 0,
    });

    expect(result.status).toBe('success');
    expect(result.response).toBe('Done with both calls');

    const convData = await readPersistedConversation(harness);

    // 6 messages: user, assistant(tc1), toolResult1, assistant(tc2), toolResult2, assistant(text)
    expect(convData.messages).toHaveLength(6);

    // Verify structure
    expect(convData.messages[0].role).toBe('user');
    expect(convData.messages[1].role).toBe('assistant');
    expect(convData.messages[1].toolCalls![0].id).toBe('tc-1');
    expect(convData.messages[2].role).toBe('user');
    expect(convData.messages[2].toolResults![0].toolCallId).toBe('tc-1');
    expect(convData.messages[3].role).toBe('assistant');
    expect(convData.messages[3].toolCalls![0].id).toBe('tc-2');
    expect(convData.messages[4].role).toBe('user');
    expect(convData.messages[4].toolResults![0].toolCallId).toBe('tc-2');
    expect(convData.messages[5].role).toBe('assistant');
    expect(convData.messages[5].content).toBe('Done with both calls');
  });

  it('does not double-append the final response in Conversation.send()', async () => {
    // With messagesPersisted=true, Conversation.send() should NOT add another
    // assistant message. Verify the final response appears exactly once.
    const provider = new ScriptedProvider([textResponse('Simple answer')]);

    harness = await buildHarness(provider);

    await (
      harness.session as unknown as {
        send(
          a: string,
          b: string,
          c: string,
          d: undefined,
          ctx: Partial<RuntimeContext>,
        ): Promise<{ status: string; response?: string }>;
      }
    ).send('user', 'test-agent', 'Hi there', undefined, {
      communicationDepth: 0,
    });

    const convData = await readPersistedConversation(harness);

    // Should be exactly 2 messages: user + assistant (not 3 with a double)
    expect(convData.messages).toHaveLength(2);
    expect(convData.messages[0].role).toBe('user');
    expect(convData.messages[1].role).toBe('assistant');
    expect(convData.messages[1].content).toBe('Simple answer');
  });

  it('passes persisted messages to subsequent LLM calls', async () => {
    // Verify that the LLM sees the full history including tool calls and results
    // by checking the messages array passed to the second LLM call.
    const provider = new ScriptedProvider([
      toolCallResponse([{ id: 'tc-1', name: 'echo', arguments: { text: 'check' } }]),
      textResponse('All done'),
    ]);

    harness = await buildHarness(provider);

    await (
      harness.session as unknown as {
        send(
          a: string,
          b: string,
          c: string,
          d: undefined,
          ctx: Partial<RuntimeContext>,
        ): Promise<{ status: string; response?: string }>;
      }
    ).send('user', 'test-agent', 'Test message', undefined, {
      communicationDepth: 0,
    });

    // The provider was called twice
    expect(provider.calls).toHaveLength(2);

    // First call should have 1 message (user)
    expect(provider.calls[0]).toHaveLength(1);
    expect(provider.calls[0][0].role).toBe('user');

    // Second call should have 3 messages (user, assistant+tc, toolResult)
    expect(provider.calls[1]).toHaveLength(3);
    expect(provider.calls[1][0].role).toBe('user');
    expect(provider.calls[1][1].role).toBe('assistant');
    expect(provider.calls[1][1].toolCalls).toBeDefined();
    expect(provider.calls[1][2].role).toBe('user');
    expect(provider.calls[1][2].toolResults).toBeDefined();
  });

  it('handles tool execution errors and persists them', async () => {
    // Use the failing_echo tool which is registered in the harness
    const provider = new ScriptedProvider([
      toolCallResponse([{ id: 'tc-1', name: 'failing_echo', arguments: { text: 'fail' } }]),
      textResponse('I see the error'),
    ]);

    harness = await buildHarness(provider);

    const result = await (
      harness.session as unknown as {
        send(
          a: string,
          b: string,
          c: string,
          d: undefined,
          ctx: Partial<RuntimeContext>,
        ): Promise<{ status: string; response?: string }>;
      }
    ).send('user', 'test-agent', 'Trigger error', undefined, {
      communicationDepth: 0,
    });

    expect(result.status).toBe('success');

    const convData = await readPersistedConversation(harness);
    expect(convData.messages).toHaveLength(4);

    // Tool result should contain the error
    const toolResultMsg = convData.messages[2];
    expect(toolResultMsg.toolResults![0].status).toBe('error');
    expect(toolResultMsg.toolResults![0].result).toContain('Something went wrong');
  });

  it('persists messages with multiple parallel tool calls', async () => {
    // Scenario: agent makes two tool calls in a single iteration
    const provider = new ScriptedProvider([
      toolCallResponse([
        { id: 'tc-1', name: 'echo', arguments: { text: 'alpha' } },
        { id: 'tc-2', name: 'echo', arguments: { text: 'beta' } },
      ]),
      textResponse('Both echoed'),
    ]);

    harness = await buildHarness(provider);

    const result = await (
      harness.session as unknown as {
        send(
          a: string,
          b: string,
          c: string,
          d: undefined,
          ctx: Partial<RuntimeContext>,
        ): Promise<{ status: string; response?: string }>;
      }
    ).send('user', 'test-agent', 'Echo two things', undefined, {
      communicationDepth: 0,
    });

    expect(result.status).toBe('success');

    const convData = await readPersistedConversation(harness);

    // 4 messages: user, assistant(tc1+tc2), toolResults(2), assistant(text)
    expect(convData.messages).toHaveLength(4);

    // Assistant message should have 2 tool calls
    expect(convData.messages[1].toolCalls).toHaveLength(2);
    expect(convData.messages[1].toolCalls![0].id).toBe('tc-1');
    expect(convData.messages[1].toolCalls![1].id).toBe('tc-2');

    // Tool results message should have 2 results
    expect(convData.messages[2].toolResults).toHaveLength(2);
    expect(convData.messages[2].toolResults![0].result).toContain('Echo: alpha');
    expect(convData.messages[2].toolResults![1].result).toContain('Echo: beta');
  });
});

// ── Approval pending persistence tests ──────────────────────────────────────

/**
 * Agent fixture with a tool that requires approval.
 */
const approvalAgent: AgentConfig = {
  id: 'approval-agent',
  type: 'agent',
  name: 'Approval Agent',
  description: 'Agent whose tool requires approval',
  systemPrompt: 'You are a test agent.',
  model: { provider: 'scripted', model: 'test-model' },
  tools: {
    guarded_tool: { mode: 'requires_approval' },
    echo: { mode: 'auto' },
  },
  approvalAuthority: {},
  status: 'active',
  createdBy: 'system',
  createdAt: '2026-01-01T00:00:00Z',
};

/**
 * Caller agent that has approval authority over approvalAgent's guarded_tool.
 */
const callerAgent: AgentConfig = {
  id: 'caller-agent',
  type: 'agent',
  name: 'Caller Agent',
  description: 'Caller with approval authority',
  systemPrompt: 'You are a caller.',
  model: { provider: 'scripted', model: 'test-model' },
  tools: {},
  approvalAuthority: {
    'approval-agent': ['guarded_tool'],
  },
  status: 'active',
  createdBy: 'system',
  createdAt: '2026-01-01T00:00:00Z',
};

interface ApprovalHarness {
  session: Session;
  provider: ScriptedProvider;
  tmpDir: string;
  storage: Storage;
  baseContext: RuntimeContext;
}

async function buildApprovalHarness(provider: ScriptedProvider): Promise<ApprovalHarness> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'legion-approval-persist-'));
  const storage = new Storage(join(tmpDir, '.legion'));

  const collective = new Collective(storage);
  collective.loadFromArray([
    userParticipant as unknown as AnyParticipantConfig,
    approvalAgent as unknown as AnyParticipantConfig,
    callerAgent as unknown as AnyParticipantConfig,
  ]);

  const toolRegistry = new ToolRegistry();
  toolRegistry.register({
    name: 'guarded_tool',
    description: 'A tool that requires approval',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string' } },
      required: ['action'],
    },
    async execute(args) {
      const { action } = args as { action: string };
      return { status: 'success', data: `Executed: ${action}` };
    },
  });

  toolRegistry.register({
    name: 'echo',
    description: 'Echo the input back',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    async execute(args) {
      const { text } = args as { text: string };
      return { status: 'success', data: `Echo: ${text}` };
    },
  });

  const authEngine = new AuthEngine({
    toolPolicies: { guarded_tool: 'requires_approval' },
  });
  const registry = new PendingApprovalRegistry();
  const eventBus = new EventBus();

  const providerMap = new Map<string, ScriptedProvider>([['approval-agent', provider]]);

  const runtimeRegistry = new RuntimeRegistry();
  const testAgentRuntime = new TestAgentRuntime(providerMap);
  runtimeRegistry.register('agent', () => testAgentRuntime);

  const { MockRuntime } = await import('./MockRuntime.js');
  runtimeRegistry.register('mock', () => new MockRuntime());

  const config = {
    get: () => undefined,
    resolveApiKey: () => 'test-key',
    getProviderConfig: () => undefined,
    load: async () => {},
  } as unknown as RuntimeContext['config'];

  const session = Session.create('test-session', storage, runtimeRegistry, collective, eventBus);

  const baseContext: RuntimeContext = {
    participant: userParticipant as unknown as RuntimeContext['participant'],
    conversation: null as unknown as RuntimeContext['conversation'],
    session,
    communicationDepth: 0,
    toolRegistry,
    config,
    eventBus,
    storage,
    authEngine,
    pendingApprovalRegistry: registry,
    callingParticipantId: 'caller-agent',
  };

  // Patch session.send to inject full context
  const originalSend = session.send.bind(session);
  (session as unknown as Record<string, unknown>).send = (
    initiatorId: string,
    targetId: string,
    message: string,
    name: string | undefined,
    ctx: RuntimeContext,
  ) => originalSend(initiatorId, targetId, message, name, { ...baseContext, ...ctx });

  return { session, provider, tmpDir, storage, baseContext };
}

async function readApprovalPersistedConversation(harness: ApprovalHarness): Promise<ConversationData> {
  const sessionId = harness.session.data.id;
  const conversationsDir = resolve(
    harness.tmpDir,
    '.legion',
    'sessions',
    sessionId,
    'conversations',
  );
  const files = await import('node:fs/promises').then((fs) => fs.readdir(conversationsDir));
  const convFile = files.find((f) => f.endsWith('.json'));
  if (!convFile) throw new Error('No conversation file found on disk');

  const raw = await readFile(join(conversationsDir, convFile), 'utf-8');
  return JSON.parse(raw) as ConversationData;
}

describe('AgentRuntime approval_pending persistence', () => {
  let harness: ApprovalHarness;

  afterEach(async () => {
    if (harness) {
      await rm(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('persists approval_pending tool results to disk when tools require approval', async () => {
    // Scenario: the LLM makes a single tool call for guarded_tool (requires_approval).
    // The caller-agent has authority, so the call is held.
    // Expected on disk: user message, assistant message with toolCalls,
    // then a tool result message with approval_pending status.
    const provider = new ScriptedProvider([
      toolCallResponse([
        { id: 'tc-1', name: 'guarded_tool', arguments: { action: 'deploy' } },
      ]),
    ]);

    harness = await buildApprovalHarness(provider);

    const result = await (
      harness.session as unknown as {
        send(
          a: string,
          b: string,
          c: string,
          d: undefined,
          ctx: Partial<RuntimeContext>,
        ): Promise<{
          status: string;
          pendingApprovals?: { requests: Array<{ requestId: string }> };
        }>;
      }
    ).send('caller-agent', 'approval-agent', 'Deploy the application', undefined, {
      communicationDepth: 0,
      callingParticipantId: 'caller-agent',
    });

    // The result should be approval_required
    expect(result.status).toBe('approval_required');
    expect(result.pendingApprovals).toBeDefined();
    expect(result.pendingApprovals!.requests).toHaveLength(1);

    // Read the persisted conversation from disk
    const convData = await readApprovalPersistedConversation(harness);

    // Should have 3 messages: user, assistant (tool calls), tool results (approval_pending)
    expect(convData.messages).toHaveLength(3);

    // 1. User message
    expect(convData.messages[0].role).toBe('user');
    expect(convData.messages[0].content).toBe('Deploy the application');

    // 2. Assistant message with tool calls
    expect(convData.messages[1].role).toBe('assistant');
    expect(convData.messages[1].toolCalls).toHaveLength(1);
    expect(convData.messages[1].toolCalls![0].tool).toBe('guarded_tool');

    // 3. Tool result message with approval_pending status
    const toolResultMsg = convData.messages[2];
    expect(toolResultMsg.role).toBe('user');
    expect(toolResultMsg.toolResults).toBeDefined();
    expect(toolResultMsg.toolResults).toHaveLength(1);

    const pendingResult = toolResultMsg.toolResults![0] as ToolCallResult;
    expect(pendingResult.toolCallId).toBe('tc-1');
    expect(pendingResult.tool).toBe('guarded_tool');
    expect(pendingResult.status).toBe('approval_pending');

    // The result field should contain JSON with approvalId and arguments
    const parsedResult = JSON.parse(pendingResult.result);
    expect(parsedResult.approvalId).toBe(result.pendingApprovals!.requests[0].requestId);
    expect(parsedResult.arguments).toEqual({ action: 'deploy' });
  });

  it('merges approval_pending and executed tool results in the same iteration', async () => {
    // Scenario: LLM makes two tool calls in one iteration:
    //   - echo (auto) → executes immediately
    //   - guarded_tool (requires_approval) → held
    // Expected: tool result message contains both results in LLM order.
    const provider = new ScriptedProvider([
      toolCallResponse([
        { id: 'tc-1', name: 'echo', arguments: { text: 'hello' } },
        { id: 'tc-2', name: 'guarded_tool', arguments: { action: 'risky-op' } },
      ]),
    ]);

    harness = await buildApprovalHarness(provider);

    const result = await (
      harness.session as unknown as {
        send(
          a: string,
          b: string,
          c: string,
          d: undefined,
          ctx: Partial<RuntimeContext>,
        ): Promise<{
          status: string;
          pendingApprovals?: { requests: Array<{ requestId: string }> };
        }>;
      }
    ).send('caller-agent', 'approval-agent', 'Do both things', undefined, {
      communicationDepth: 0,
      callingParticipantId: 'caller-agent',
    });

    expect(result.status).toBe('approval_required');

    const convData = await readApprovalPersistedConversation(harness);

    // 3 messages: user, assistant (2 tool calls), tool results (2 results)
    expect(convData.messages).toHaveLength(3);

    const toolResultMsg = convData.messages[2];
    expect(toolResultMsg.toolResults).toHaveLength(2);

    // First result: echo (executed immediately, success)
    const echoResult = toolResultMsg.toolResults![0] as ToolCallResult;
    expect(echoResult.toolCallId).toBe('tc-1');
    expect(echoResult.tool).toBe('echo');
    expect(echoResult.status).toBe('success');
    expect(echoResult.result).toContain('Echo: hello');

    // Second result: guarded_tool (held, approval_pending)
    const guardedResult = toolResultMsg.toolResults![1] as ToolCallResult;
    expect(guardedResult.toolCallId).toBe('tc-2');
    expect(guardedResult.tool).toBe('guarded_tool');
    expect(guardedResult.status).toBe('approval_pending');

    const parsedResult = JSON.parse(guardedResult.result);
    expect(parsedResult.approvalId).toBe(result.pendingApprovals!.requests[0].requestId);
    expect(parsedResult.arguments).toEqual({ action: 'risky-op' });
  });
});
