/**
 * End-to-end integration tests for the approval authority delegation flow.
 *
 * These tests exercise the real pipeline:
 *   Session → Conversation → AgentRuntime (scripted LLM) → ToolExecutor → communicate
 *   → downstream AgentRuntime (scripted LLM) → batched pending → approval_response → resume
 *
 * Purpose: validate whether approval authority routing works correctly end-to-end,
 * including the path back from communicate's `approval_required` result through the
 * calling agent's agentic loop.
 */

import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { Session } from '../communication/Session.js';
import { Collective } from '../collective/Collective.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { RuntimeRegistry } from './RuntimeRegistry.js';
import { AgentRuntime } from './AgentRuntime.js';
import { MockRuntime } from './MockRuntime.js';
import { AuthEngine } from '../authorization/AuthEngine.js';
import { PendingApprovalRegistry } from '../authorization/PendingApprovalRegistry.js';
import { EventBus } from '../events/EventBus.js';
import { Storage } from '../workspace/Storage.js';
import { communicateTool } from '../tools/communicate.js';
import { approvalResponseTool } from '../tools/approval-tools.js';
import type { AgentConfig, MockConfig } from '../collective/Participant.js';
import type { LLMProvider, ChatOptions, ChatResponse } from '../providers/Provider.js';
import type { Message } from '../communication/Message.js';
import type { RuntimeContext } from './ParticipantRuntime.js';

// ── Scripted LLM provider ───────────────────────────────────────────────────

type ResponseFn = (messages: Message[]) => ChatResponse;

/**
 * Flexible scripted provider. Each response entry is either a static ChatResponse
 * or a function that receives the current messages and returns a response.
 * The function form lets tests extract runtime values (e.g. requestIds) from
 * the messages the LLM would see and build responses accordingly.
 */
class ScriptedProvider implements LLMProvider {
  readonly name = 'scripted';
  private queue: Array<ChatResponse | ResponseFn>;
  readonly calls: Array<Message[]> = [];

  constructor(responses: Array<ChatResponse | ResponseFn>) {
    this.queue = [...responses];
  }

  async chat(messages: Message[], _opts: ChatOptions): Promise<ChatResponse> {
    this.calls.push(messages);
    const next = this.queue.shift();
    if (!next) throw new Error(`ScriptedProvider: no more responses (received ${messages.length} messages)`);
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

/**
 * Subclass that injects a scripted LLM provider per agent ID.
 * createProvider() is now protected so we can override it cleanly.
 */
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

// ur-agent uses communicate + approval_response; has authority to approve
// file_write calls made by coding-agent on its behalf.
function makeURAgent(approvalAuthority: AgentConfig['approvalAuthority']): AgentConfig {
  return {
    id: 'ur-agent',
    type: 'agent',
    name: 'UR Agent',
    description: 'Coordinator',
    systemPrompt: 'You are a coordinator.',
    model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    tools: {
      communicate: { mode: 'auto' },
      approval_response: { mode: 'auto' },
    },
    approvalAuthority,
    status: 'active',
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

const codingAgent: AgentConfig = {
  id: 'coding-agent',
  type: 'agent',
  name: 'Coding Agent',
  description: 'Writes code',
  systemPrompt: 'You write code.',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: {
    file_write: { mode: 'requires_approval' },
  },
  approvalAuthority: {},
  status: 'active',
  createdBy: 'system',
  createdAt: '2026-01-01T00:00:00Z',
};

// ── Test harness factory ────────────────────────────────────────────────────

interface Harness {
  session: Session;
  providerMap: Map<string, ScriptedProvider>;
  registry: PendingApprovalRegistry;
  toolsExecuted: string[];
  tmpDir: string;
  baseContext: RuntimeContext;
}

async function buildHarness(
  urAgent: AgentConfig,
  urProvider: ScriptedProvider,
  codingProvider: ScriptedProvider,
): Promise<Harness> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'legion-e2e-'));
  const storage = new Storage(join(tmpDir, '.legion'));

  const collective = new Collective(storage);
  collective.loadFromArray([userParticipant, urAgent, codingAgent]);

  const toolsExecuted: string[] = [];
  const toolRegistry = new ToolRegistry();

  toolRegistry.register(communicateTool);
  toolRegistry.register(approvalResponseTool);
  toolRegistry.register({
    name: 'file_write',
    description: 'Write a file',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
    async execute(args) {
      const { path } = args as { path: string };
      toolsExecuted.push(`file_write:${path}`);
      return { status: 'success', data: `Wrote ${path}` };
    },
  });

  const authEngine = new AuthEngine({
    toolPolicies: { file_write: 'requires_approval' },
  });

  const registry = new PendingApprovalRegistry();
  const eventBus = new EventBus();

  const providerMap = new Map<string, ScriptedProvider>([
    ['ur-agent', urProvider],
    ['coding-agent', codingProvider],
  ]);

  const runtimeRegistry = new RuntimeRegistry();
  const testAgentRuntime = new TestAgentRuntime(providerMap);
  runtimeRegistry.register('agent', () => testAgentRuntime);
  runtimeRegistry.register('mock', () => new MockRuntime());

  const config = {
    get: () => undefined,
    resolveApiKey: () => 'test-key',
    load: async () => {},
  } as unknown as RuntimeContext['config'];

  const session = Session.create(
    'test-session',
    storage,
    runtimeRegistry,
    collective,
    eventBus,
  );

  // Build a minimal base context that session.send() will spread into each conversation.
  // We monkey-patch send() to inject the missing context fields.
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

  return { session, providerMap, registry, toolsExecuted, tmpDir, baseContext };
}

async function cleanHarness(harness: Harness) {
  await rm(harness.tmpDir, { recursive: true, force: true });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Approval delegation — end-to-end via Session/Conversation', () => {
  /**
   * Scenario A: caller HAS authority.
   *
   * ur-agent (approvalAuthority: {'coding-agent': ['file_write']}) delegates to coding-agent.
   * coding-agent calls file_write → should be batched as pending and returned
   * to ur-agent rather than escalating to a user approval handler.
   *
   * This test verifies:
   *   1. The approval_required result surfaces back to ur-agent's LLM as a tool result
   *      (meaning communicate's result feeds back into the loop, not an early exit).
   *   2. ur-agent can then call approval_response to resume coding-agent.
   *   3. coding-agent's file_write actually executes after approval.
   *   4. The final session.send() result is 'success'.
   */
  it('routes pending approvals back to calling agent when caller has authority', async () => {
    const urAgent = makeURAgent({ 'coding-agent': ['file_write'] });

    // coding-agent: calls file_write, then after approval responds with text
    const codingProvider = new ScriptedProvider([
      toolCallResponse([{ id: 'tc-1', name: 'file_write', arguments: { path: 'src/auth.ts', content: 'code' } }]),
      textResponse('I have written src/auth.ts.'),
    ]);

    // ur-agent LLM responses:
    //  Call 1: call communicate
    //  Call 2: communicate returns approval_required data as a tool result;
    //          extract the requestId from the message, then call approval_response
    //  Call 3: after approval_response returns coding-agent's final text, summarise
    const urProvider = new ScriptedProvider([
      toolCallResponse([{ id: 'tc-u1', name: 'communicate', arguments: { participantId: 'coding-agent', message: 'Write src/auth.ts' } }]),
      (messages: Message[]) => {
        const lastMsg = messages[messages.length - 1];
        const toolResult = lastMsg?.toolResults?.[0];
        let requestId = '__missing__';
        if (toolResult?.result) {
          try {
            const data = JSON.parse(toolResult.result as string) as { requests?: Array<{ requestId: string }> };
            requestId = data.requests?.[0]?.requestId ?? '__missing__';
          } catch { /* extraction failed — test will catch this below */ }
        }
        return toolCallResponse([{ id: 'tc-u2', name: 'approval_response', arguments: { responses: [{ requestId, approved: true }] } }]);
      },
      textResponse('Done — coding agent wrote the file.'),
    ]);

    const harness = await buildHarness(urAgent, urProvider, codingProvider);

    try {
      // Only pass override fields — baseContext supplies toolRegistry, authEngine, etc.
      const result = await (harness.session as unknown as {
        send(a: string, b: string, c: string, d: undefined, ctx: Partial<RuntimeContext>): Promise<unknown>
      }).send('user', 'ur-agent', 'Write src/auth.ts', undefined, {
        pendingApprovalRegistry: harness.registry,
        communicationDepth: 0,
      });

      // ur-agent's LLM must have been called 3 times:
      //   1st → communicate, 2nd → approval_response, 3rd → final text
      expect(urProvider.calls).toHaveLength(3);

      // The 3rd call's last message is the approval_response tool result.
      // It should hold coding-agent's final response text.
      const thirdCallMessages = urProvider.calls[2];
      const arToolResult = thirdCallMessages[thirdCallMessages.length - 1]?.toolResults?.[0];
      // If the requestId was '__missing__', approval_response would return an error.
      // If the routing bug is present, the 2nd LLM call never happens at all.
      expect(arToolResult?.result).toBe('I have written src/auth.ts.');

      // file_write must have executed (coding-agent was resumed after approval)
      expect(harness.toolsExecuted).toContain('file_write:src/auth.ts');

      // The registry should be clear — batch resolved
      expect(harness.registry.listPending()).toHaveLength(0);

      // Overall result should be success with ur-agent's final text
      const r = result as { status: string; response?: string };
      expect(r.status).toBe('success');
      expect(r.response).toContain('coding agent wrote');
    } finally {
      await cleanHarness(harness);
    }
  });

  /**
   * Scenario B: caller LACKS authority.
   *
   * ur-agent has empty approvalAuthority — no delegation rights.
   * coding-agent calls file_write → should NOT be batched.
   * Without an approval handler on AuthEngine, it should be rejected/denied.
   * The pending registry must remain empty.
   */
  it('does not batch pending approvals when caller lacks authority', async () => {
    const urAgent = makeURAgent({}); // no authority

    const codingProvider = new ScriptedProvider([
      toolCallResponse([{ id: 'tc-1', name: 'file_write', arguments: { path: 'src/auth.ts', content: 'code' } }]),
      textResponse('Unable to write — approval required.'),
    ]);

    const urProvider = new ScriptedProvider([
      toolCallResponse([{ id: 'tc-u1', name: 'communicate', arguments: { participantId: 'coding-agent', message: 'Write src/auth.ts' } }]),
      textResponse('Coding agent could not write the file — approval needed.'),
    ]);

    const harness = await buildHarness(urAgent, urProvider, codingProvider);

    try {
      await (harness.session as unknown as {
        send(a: string, b: string, c: string, d: undefined, ctx: Partial<RuntimeContext>): Promise<unknown>
      }).send('user', 'ur-agent', 'Write src/auth.ts', undefined, {
        pendingApprovalRegistry: harness.registry,
        communicationDepth: 0,
      });

      // No pending approvals should be stored — caller has no authority
      expect(harness.registry.listPending()).toHaveLength(0);

      // file_write must NOT have executed (rejected without a handler)
      expect(harness.toolsExecuted).toHaveLength(0);
    } finally {
      await cleanHarness(harness);
    }
  });

  /**
   * Scenario C: direct communicate → approval_response flow (no ur-agent LLM).
   *
   * Tests the core plumbing by calling communicate directly as a tool,
   * then calling approval_response directly — bypassing the ur-agent LLM layer.
   * This isolates whether the registry + resume pipeline works independently
   * of the AgentRuntime calling loop.
   */
  it('communicate → approval_response pipeline works end-to-end', async () => {
    const urAgent = makeURAgent({ 'coding-agent': ['file_write'] });

    // coding-agent: calls file_write once, then responds with text after resume
    const codingProvider = new ScriptedProvider([
      toolCallResponse([{ id: 'tc-1', name: 'file_write', arguments: { path: 'src/auth.ts', content: 'code' } }]),
      textResponse('File written.'),
    ]);

    // ur-agent provider won't be called in this test (we drive tools directly)
    const urProvider = new ScriptedProvider([]);

    const harness = await buildHarness(urAgent, urProvider, codingProvider);

    try {
      // Build a context as if ur-agent is the caller
      const baseCtx: RuntimeContext = {
        participant: urAgent,
        conversation: {
          data: { sessionId: 'test-session', initiatorId: 'ur-agent', targetId: 'coding-agent' },
          getMessages: () => [],
          isBusy: false,
        } as unknown as RuntimeContext['conversation'],
        session: harness.session,
        communicationDepth: 0,
        toolRegistry: (() => {
          // Resolve tools as ur-agent would see them
          const tr = new ToolRegistry();
          tr.register(communicateTool);
          tr.register(approvalResponseTool);
          tr.register({
            name: 'file_write',
            description: 'Write a file',
            parameters: { type: 'object', properties: {} },
            async execute(args) {
              const { path } = args as { path: string };
              harness.toolsExecuted.push(`file_write:${path}`);
              return { status: 'success', data: `Wrote ${path}` };
            },
          });
          return tr;
        })(),
        config: { get: () => undefined, resolveApiKey: () => 'test-key' } as unknown as RuntimeContext['config'],
        eventBus: new EventBus(),
        storage: new Storage(join(harness.tmpDir, '.legion')),
        authEngine: new AuthEngine({ toolPolicies: { file_write: 'requires_approval' } }),
        pendingApprovalRegistry: harness.registry,
        callingParticipantId: undefined,
      };

      // Step 1: communicate from ur-agent to coding-agent
      const commResult = await communicateTool.execute(
        { participantId: 'coding-agent', message: 'Write src/auth.ts' },
        baseCtx,
      );

      // communicate should return approval_required because coding-agent batched
      // the file_write and needs ur-agent's approval
      expect(commResult.status).toBe('approval_required');

      const commData = commResult.data as {
        conversationId: string;
        requests: Array<{ requestId: string; toolName: string }>;
      };

      expect(commData).toBeDefined();
      expect(commData.requests).toHaveLength(1);
      expect(commData.requests[0].toolName).toBe('file_write');

      // The registry must have the batch stored
      expect(harness.registry.hasPending(commData.conversationId)).toBe(true);
      const batch = harness.registry.get(commData.conversationId)!;
      expect(batch.callingParticipantId).toBe('ur-agent');
      expect(batch.requestingParticipantId).toBe('coding-agent');

      // Step 2: ur-agent approves via approval_response
      const approvalResult = await approvalResponseTool.execute(
        {
          responses: [{ requestId: commData.requests[0].requestId, approved: true }],
        },
        baseCtx,
      );

      // Approval should succeed and return coding-agent's final response
      expect(approvalResult.status).toBe('success');
      expect(approvalResult.data).toBe('File written.');

      // file_write must have executed
      expect(harness.toolsExecuted).toContain('file_write:src/auth.ts');

      // Registry should be cleared
      expect(harness.registry.listPending()).toHaveLength(0);
    } finally {
      await cleanHarness(harness);
    }
  });

  /**
   * Scenario D: re-call communicate while paused.
   *
   * If ur-agent calls communicate again while coding-agent is paused
   * (before approving), it should get back the same pending requests —
   * not trigger a new message.
   */
  it('re-calling communicate while paused returns pending requests, not a new message', async () => {
    const urAgent = makeURAgent({ 'coding-agent': ['file_write'] });

    // coding-agent starts with a file_write — only one call expected
    const codingProvider = new ScriptedProvider([
      toolCallResponse([{ id: 'tc-1', name: 'file_write', arguments: { path: 'src/auth.ts', content: 'code' } }]),
      textResponse('File written.'),
    ]);

    const urProvider = new ScriptedProvider([]);
    const harness = await buildHarness(urAgent, urProvider, codingProvider);

    try {
      const baseCtx: RuntimeContext = {
        participant: urAgent,
        conversation: {
          data: { sessionId: 'test-session', initiatorId: 'ur-agent', targetId: 'coding-agent' },
          getMessages: () => [],
          isBusy: false,
        } as unknown as RuntimeContext['conversation'],
        session: harness.session,
        communicationDepth: 0,
        toolRegistry: (() => {
          const tr = new ToolRegistry();
          tr.register(communicateTool);
          tr.register(approvalResponseTool);
          tr.register({
            name: 'file_write',
            description: 'Write',
            parameters: { type: 'object', properties: {} },
            async execute(args) {
              const { path } = args as { path: string };
              harness.toolsExecuted.push(`file_write:${path}`);
              return { status: 'success', data: `Wrote ${path}` };
            },
          });
          return tr;
        })(),
        config: { get: () => undefined, resolveApiKey: () => 'test-key' } as unknown as RuntimeContext['config'],
        eventBus: new EventBus(),
        storage: new Storage(join(harness.tmpDir, '.legion')),
        authEngine: new AuthEngine({ toolPolicies: { file_write: 'requires_approval' } }),
        pendingApprovalRegistry: harness.registry,
        callingParticipantId: undefined,
      };

      // First call — coding-agent batches and pauses
      const result1 = await communicateTool.execute(
        { participantId: 'coding-agent', message: 'Write src/auth.ts' },
        baseCtx,
      );
      expect(result1.status).toBe('approval_required');
      const firstData = result1.data as { conversationId: string; requests: Array<{ requestId: string }> };

      // Second call to communicate — should get back same pending, not send a new message
      // (coding-agent's ScriptedProvider has NO more responses — it would throw if called again)
      const result2 = await communicateTool.execute(
        { participantId: 'coding-agent', message: 'Are you done yet?' },
        baseCtx,
      );

      expect(result2.status).toBe('approval_required');
      const secondData = result2.data as { conversationId: string; requests: Array<{ requestId: string }> };

      // Same conversationId and same requestId — the batch was not duplicated
      expect(secondData.conversationId).toBe(firstData.conversationId);
      expect(secondData.requests[0].requestId).toBe(firstData.requests[0].requestId);

      // Only one batch in the registry
      expect(harness.registry.listPending()).toHaveLength(1);
    } finally {
      await cleanHarness(harness);
    }
  });
});
