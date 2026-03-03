/**
 * Integration tests for Phase 3.3: Approval Authority Delegation.
 *
 * Tests the full delegation flow:
 *   1. AgentRuntime holds tool calls requiring caller approval
 *   2. communicate surfaces pending requests to the calling agent
 *   3. approval_response resumes the paused agent and returns its final result
 *   4. Re-calling communicate while paused returns pending requests unchanged
 *
 * Uses a mock LLM provider to script agent responses without network calls.
 */

import { AgentRuntime } from '../runtime/AgentRuntime.js';
import { AuthEngine } from '../authorization/AuthEngine.js';
import { PendingApprovalRegistry } from '../authorization/PendingApprovalRegistry.js';
import { approvalResponseTool } from './approval-tools.js';
import { communicateTool } from './communicate.js';
import { ToolRegistry } from './ToolRegistry.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';
import type { AgentConfig } from '../collective/Participant.js';
import type { LLMProvider, ChatOptions, ChatResponse } from '../providers/Provider.js';
import type { Message } from '../communication/Message.js';
import { createMessage } from '../communication/Message.js';
import { EventBus } from '../events/EventBus.js';
import { RuntimeConfig } from '../runtime/RuntimeConfig.js';

// ── Mock LLM Provider ───────────────────────────────────────────────────────

/**
 * A scripted LLM provider for testing. Each call pops the next response
 * from the queue. Throws if the queue is empty.
 */
class MockLLMProvider implements LLMProvider {
  private responses: ChatResponse[];

  constructor(responses: ChatResponse[]) {
    this.responses = [...responses];
  }

  async chat(_messages: Message[], _opts: ChatOptions): Promise<ChatResponse> {
    const next = this.responses.shift();
    if (!next) throw new Error('MockLLMProvider: no more scripted responses');
    return next;
  }

  async listModels() {
    return { models: [] };
  }
}

function toolCallResponse(
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  content = '',
): ChatResponse {
  return {
    content,
    toolCalls: toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    })),
    model: 'mock-model',
    stopReason: 'tool_use',
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function textResponse(content: string): ChatResponse {
  return {
    content,
    toolCalls: [],
    model: 'mock-model',
    stopReason: 'end_turn',
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

// ── Test participants ───────────────────────────────────────────────────────

const callerParticipant = {
  id: 'ur-agent',
  type: 'agent' as const,
  name: 'UR Agent',
  description: 'The calling agent',
  tools: {},
  approvalAuthority: {
    // ur-agent can approve file_write and process_exec for coding-agent
    'coding-agent': ['file_write', 'process_exec'],
  },
  status: 'active' as const,
};

const callerWithScopedAuthority = {
  id: 'ur-agent-scoped',
  type: 'agent' as const,
  name: 'UR Agent (scoped)',
  description: 'Only approves file_write in src/**',
  tools: {},
  approvalAuthority: {
    'coding-agent': {
      file_write: {
        rules: [
          { mode: 'auto' as const, scope: { paths: ['src/**'] } },
          { mode: 'deny' as const },
        ],
      },
    },
  },
  status: 'active' as const,
};

const codingAgent: AgentConfig = {
  id: 'coding-agent',
  type: 'agent' as const,
  name: 'Coding Agent',
  description: 'The downstream agent',
  tools: {},
  approvalAuthority: {},
  status: 'active' as const,
  model: { provider: 'anthropic', model: 'mock-model' },
  systemPrompt: 'You are a coding assistant.',
  createdBy: 'user',
  createdAt: '2026-01-01T00:00:00Z',
};

// ── Tool stubs ──────────────────────────────────────────────────────────────

function createTestToolRegistry(tools?: Record<string, () => Promise<unknown>>) {
  const registry = new ToolRegistry();

  const toolMap = tools ?? {
    file_write: async () => 'File written successfully',
    file_read: async () => 'File contents',
    process_exec: async () => 'Process output',
  };

  for (const [name, executeFn] of Object.entries(toolMap)) {
    registry.register({
      name,
      description: `Test ${name}`,
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ status: 'success' as const, data: await executeFn() }),
    });
  }

  // Also register approval_response for tests that need it
  registry.register(approvalResponseTool);

  return registry;
}

// ── Context factory ─────────────────────────────────────────────────────────

function createContext(
  overrides: Partial<{
    callingParticipantId: string;
    callerParticipant: typeof callerParticipant;
    toolRegistry: ToolRegistry;
    authEngine: AuthEngine;
    pendingApprovalRegistry: PendingApprovalRegistry;
    conversationName?: string;
  }> = {},
): RuntimeContext & { conversation: { data: { initiatorId: string; targetId: string; name?: string; sessionId: string } } } {
  const pendingApprovalRegistry = overrides.pendingApprovalRegistry ?? new PendingApprovalRegistry();
  const authEngine = overrides.authEngine ?? new AuthEngine({
    toolPolicies: {
      file_write: 'requires_approval',
      process_exec: 'requires_approval',
      file_read: 'auto',
    },
  });
  const toolRegistry = overrides.toolRegistry ?? createTestToolRegistry();
  const caller = overrides.callerParticipant ?? callerParticipant;
  const conversationName = overrides.conversationName;

  const conversation = {
    data: {
      sessionId: 'test-session',
      initiatorId: caller.id,
      targetId: codingAgent.id,
      name: conversationName,
      messages: [] as Message[],
      createdAt: '2026-01-01T00:00:00Z',
    },
    getMessages: () => [] as ReadonlyArray<Message>,
    isBusy: false,
  };

  return {
    participant: codingAgent,
    conversation: conversation as unknown as RuntimeContext['conversation'],
    session: {
      data: { id: 'test-session', name: 'Test', createdAt: '2026-01-01T00:00:00Z', status: 'active' },
      collective: {
        get: (id: string) => {
          if (id === caller.id) return caller;
          if (id === codingAgent.id) return codingAgent;
          return undefined;
        },
      },
    } as unknown as RuntimeContext['session'],
    communicationDepth: 1,
    toolRegistry,
    config: { get: () => undefined, resolveApiKey: () => 'test-key' } as unknown as RuntimeContext['config'],
    eventBus: new EventBus(),
    storage: {} as RuntimeContext['storage'],
    authEngine,
    callingParticipantId: overrides.callingParticipantId ?? caller.id,
    pendingApprovalRegistry,
  } as unknown as RuntimeContext & { conversation: { data: { initiatorId: string; targetId: string; name?: string; sessionId: string } } };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AgentRuntime — caller approval batching', () => {
  it('holds tool calls requiring caller approval and returns approval_required', async () => {
    const registry = new PendingApprovalRegistry();
    const provider = new MockLLMProvider([
      toolCallResponse([{ id: 'tc-1', name: 'file_write', arguments: { path: 'src/auth.ts', content: 'code' } }]),
    ]);

    const context = createContext({ pendingApprovalRegistry: registry });
    const runtime = new AgentRuntime();
    const runtimeConfig = RuntimeConfig.resolve({ get: () => undefined } as unknown as RuntimeContext['config']);

    const result = await runtime.runLoop(
      [createMessage('user', 'ur-agent', 'Write the auth module')],
      0,
      context,
      codingAgent,
      runtimeConfig,
      provider,
      [{ name: 'file_write', description: 'Write a file', parameters: { type: 'object', properties: {} } }],
    );

    expect(result.status).toBe('approval_required');
    expect(result.pendingApprovals).toBeDefined();
    expect(result.pendingApprovals!.requests).toHaveLength(1);
    expect(result.pendingApprovals!.requests[0].toolName).toBe('file_write');
    expect(result.pendingApprovals!.requests[0].toolArguments).toEqual({ path: 'src/auth.ts', content: 'code' });

    // Registry should have the batch stored
    expect(registry.hasPending(result.pendingApprovals!.conversationId)).toBe(true);
  });

  it('executes auto tools immediately without holding', async () => {
    let fileReadCalled = false;
    const registry = new PendingApprovalRegistry();
    const toolRegistry = createTestToolRegistry({
      file_read: async () => {
        fileReadCalled = true;
        return 'file contents';
      },
    });

    const provider = new MockLLMProvider([
      // First iteration: file_read (auto) + file_write (requires approval)
      toolCallResponse([
        { id: 'tc-1', name: 'file_read', arguments: { path: 'src/auth.ts' } },
        { id: 'tc-2', name: 'file_write', arguments: { path: 'src/new.ts', content: 'new' } },
      ]),
    ]);

    const context = createContext({ pendingApprovalRegistry: registry, toolRegistry });
    const runtime = new AgentRuntime();
    const runtimeConfig = RuntimeConfig.resolve({ get: () => undefined } as unknown as RuntimeContext['config']);

    const result = await runtime.runLoop(
      [createMessage('user', 'ur-agent', 'Read and update')],
      0,
      context,
      codingAgent,
      runtimeConfig,
      provider,
      [
        { name: 'file_read', description: 'Read', parameters: { type: 'object', properties: {} } },
        { name: 'file_write', description: 'Write', parameters: { type: 'object', properties: {} } },
      ],
    );

    expect(result.status).toBe('approval_required');
    // file_read was executed immediately
    expect(fileReadCalled).toBe(true);
    // Only file_write is pending
    expect(result.pendingApprovals!.requests).toHaveLength(1);
    expect(result.pendingApprovals!.requests[0].toolName).toBe('file_write');
  });

  it('batches multiple tool calls from one iteration into a single pending batch', async () => {
    const registry = new PendingApprovalRegistry();
    const provider = new MockLLMProvider([
      toolCallResponse([
        { id: 'tc-1', name: 'file_write', arguments: { path: 'src/a.ts', content: 'a' } },
        { id: 'tc-2', name: 'process_exec', arguments: { command: 'npm test' } },
        { id: 'tc-3', name: 'file_write', arguments: { path: 'src/b.ts', content: 'b' } },
      ]),
    ]);

    const context = createContext({ pendingApprovalRegistry: registry });
    const runtime = new AgentRuntime();
    const runtimeConfig = RuntimeConfig.resolve({ get: () => undefined } as unknown as RuntimeContext['config']);

    const result = await runtime.runLoop(
      [createMessage('user', 'ur-agent', 'Do multiple things')],
      0,
      context,
      codingAgent,
      runtimeConfig,
      provider,
      [
        { name: 'file_write', description: 'Write', parameters: { type: 'object', properties: {} } },
        { name: 'process_exec', description: 'Exec', parameters: { type: 'object', properties: {} } },
      ],
    );

    expect(result.status).toBe('approval_required');
    expect(result.pendingApprovals!.requests).toHaveLength(3);

    const toolNames = result.pendingApprovals!.requests.map((r) => r.toolName);
    expect(toolNames).toContain('file_write');
    expect(toolNames).toContain('process_exec');

    // All three are in ONE batch, not three separate batches
    expect(registry.listPending()).toHaveLength(1);
  });

  it('resumes execution after approval and continues the loop to completion', async () => {
    const registry = new PendingApprovalRegistry();
    const provider = new MockLLMProvider([
      toolCallResponse([{ id: 'tc-1', name: 'file_write', arguments: { path: 'src/auth.ts', content: 'code' } }]),
      textResponse('I have written the auth module.'),
    ]);

    const context = createContext({ pendingApprovalRegistry: registry });
    const runtime = new AgentRuntime();
    const runtimeConfig = RuntimeConfig.resolve({ get: () => undefined } as unknown as RuntimeContext['config']);

    const result = await runtime.runLoop(
      [createMessage('user', 'ur-agent', 'Write the auth module')],
      0,
      context,
      codingAgent,
      runtimeConfig,
      provider,
      [{ name: 'file_write', description: 'Write', parameters: { type: 'object', properties: {} } }],
    );

    expect(result.status).toBe('approval_required');
    const { conversationId, requests } = result.pendingApprovals!;
    const batch = registry.get(conversationId)!;

    // Approve the request
    const decisions = new Map([[requests[0].requestId, { approved: true }]]);
    const resumeResult = await batch.resume(decisions);

    expect(resumeResult.status).toBe('success');
    expect(resumeResult.response).toBe('I have written the auth module.');

    // Registry should be cleared after resume
    expect(registry.hasPending(conversationId)).toBe(false);
  });

  it('rejects held tool calls when decision is approved=false', async () => {
    const registry = new PendingApprovalRegistry();
    let fileWriteCalled = false;
    const toolRegistry = createTestToolRegistry({
      file_write: async () => {
        fileWriteCalled = true;
        return 'written';
      },
    });

    const provider = new MockLLMProvider([
      toolCallResponse([{ id: 'tc-1', name: 'file_write', arguments: { path: 'src/auth.ts', content: 'code' } }]),
      textResponse('The write was rejected.'),
    ]);

    const context = createContext({ pendingApprovalRegistry: registry, toolRegistry });
    const runtime = new AgentRuntime();
    const runtimeConfig = RuntimeConfig.resolve({ get: () => undefined } as unknown as RuntimeContext['config']);

    const result = await runtime.runLoop(
      [createMessage('user', 'ur-agent', 'Write auth')],
      0,
      context,
      codingAgent,
      runtimeConfig,
      provider,
      [{ name: 'file_write', description: 'Write', parameters: { type: 'object', properties: {} } }],
    );

    expect(result.status).toBe('approval_required');
    const { conversationId, requests } = result.pendingApprovals!;
    const batch = registry.get(conversationId)!;

    // Reject the request
    const decisions = new Map([[requests[0].requestId, { approved: false, reason: 'Not safe' }]]);
    const resumeResult = await batch.resume(decisions);

    expect(resumeResult.status).toBe('success');
    expect(resumeResult.response).toBe('The write was rejected.');
    // Tool should NOT have been executed
    expect(fileWriteCalled).toBe(false);
  });

  it('does not hold tools when there is no callingParticipantId', async () => {
    const registry = new PendingApprovalRegistry();

    // AuthEngine with no approval handler — will deny requires_approval tools
    const authEngine = new AuthEngine({
      toolPolicies: {
        file_write: 'requires_approval',
      },
    });

    const provider = new MockLLMProvider([
      toolCallResponse([{ id: 'tc-1', name: 'file_write', arguments: { path: 'src/auth.ts', content: 'code' } }]),
    ]);

    const context = {
      ...createContext({ pendingApprovalRegistry: registry, authEngine }),
      callingParticipantId: undefined, // No caller
    } as unknown as RuntimeContext;

    const runtime = new AgentRuntime();
    const runtimeConfig = RuntimeConfig.resolve({ get: () => undefined } as unknown as RuntimeContext['config']);

    const result = await runtime.runLoop(
      [createMessage('user', 'system', 'Write')],
      0,
      context,
      codingAgent,
      runtimeConfig,
      provider,
      [{ name: 'file_write', description: 'Write', parameters: { type: 'object', properties: {} } }],
    );

    // Without callingParticipantId, no batch is held — falls through to normal auth
    // (no handler → denied by default)
    expect(result.status).not.toBe('approval_required');
    expect(registry.listPending()).toHaveLength(0);
  });

  it('does not hold tools when caller lacks authority', async () => {
    const callerWithNoAuthority = {
      ...callerParticipant,
      id: 'no-auth-agent',
      approvalAuthority: {}, // no authority
    };

    const registry = new PendingApprovalRegistry();
    const authEngine = new AuthEngine({
      toolPolicies: { file_write: 'requires_approval' },
    });

    const provider = new MockLLMProvider([
      toolCallResponse([{ id: 'tc-1', name: 'file_write', arguments: { path: 'src/auth.ts' } }]),
    ]);

    const context = createContext({
      callerParticipant: callerWithNoAuthority,
      pendingApprovalRegistry: registry,
      authEngine,
    });

    const runtime = new AgentRuntime();
    const runtimeConfig = RuntimeConfig.resolve({ get: () => undefined } as unknown as RuntimeContext['config']);

    const result = await runtime.runLoop(
      [createMessage('user', 'no-auth-agent', 'Write')],
      0,
      context,
      codingAgent,
      runtimeConfig,
      provider,
      [{ name: 'file_write', description: 'Write', parameters: { type: 'object', properties: {} } }],
    );

    // Without authority, tool goes to normal auth path → no-handler → denied
    expect(registry.listPending()).toHaveLength(0);
    // Result is not approval_required with pending approvals
    expect(result.pendingApprovals).toBeUndefined();
  });
});

// ── approval_response tool ──────────────────────────────────────────────────

describe('approval_response tool', () => {
  it('resolves pending requests and returns the agent final result', async () => {
    const registry = new PendingApprovalRegistry();

    let resumeCalled = false;
    registry.store('ur-agent__coding-agent', {
      conversationId: 'ur-agent__coding-agent',
      requestingParticipantId: 'coding-agent',
      callingParticipantId: 'ur-agent',
      requests: [
        {
          requestId: 'req-1',
          toolCallId: 'tc-1',
          toolName: 'file_write',
          toolArguments: { path: 'src/auth.ts', content: 'code' },
        },
      ],
      resume: async (_decisions) => {
        resumeCalled = true;
        return { status: 'success', response: 'Auth module written.' };
      },
    });

    const context = {
      participant: { ...callerParticipant },
      pendingApprovalRegistry: registry,
    } as unknown as RuntimeContext;

    const result = await approvalResponseTool.execute(
      { responses: [{ requestId: 'req-1', approved: true }] },
      context,
    );

    expect(result.status).toBe('success');
    expect(result.data).toBe('Auth module written.');
    expect(resumeCalled).toBe(true);
  });

  it('passes correct decisions to resume', async () => {
    const registry = new PendingApprovalRegistry();

    let capturedDecisions: Map<string, { approved: boolean; reason?: string }> | null = null;

    registry.store('ur-agent__coding-agent', {
      conversationId: 'ur-agent__coding-agent',
      requestingParticipantId: 'coding-agent',
      callingParticipantId: 'ur-agent',
      requests: [
        { requestId: 'req-1', toolCallId: 'tc-1', toolName: 'file_write', toolArguments: {} },
        { requestId: 'req-2', toolCallId: 'tc-2', toolName: 'process_exec', toolArguments: {} },
      ],
      resume: async (decisions) => {
        capturedDecisions = decisions;
        return { status: 'success', response: 'done' };
      },
    });

    const context = {
      participant: { ...callerParticipant },
      pendingApprovalRegistry: registry,
    } as unknown as RuntimeContext;

    await approvalResponseTool.execute(
      {
        responses: [
          { requestId: 'req-1', approved: true },
          { requestId: 'req-2', approved: false, reason: 'Too risky' },
        ],
      },
      context,
    );

    expect(capturedDecisions).not.toBeNull();
    expect(capturedDecisions!.get('req-1')).toEqual({ approved: true, reason: undefined });
    expect(capturedDecisions!.get('req-2')).toEqual({ approved: false, reason: 'Too risky' });
  });

  it('returns error for unknown requestIds', async () => {
    const registry = new PendingApprovalRegistry();

    const context = {
      participant: { ...callerParticipant },
      pendingApprovalRegistry: registry,
    } as unknown as RuntimeContext;

    const result = await approvalResponseTool.execute(
      { responses: [{ requestId: 'unknown-req', approved: true }] },
      context,
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('unknown-req');
  });

  it('returns error when called by wrong participant', async () => {
    const registry = new PendingApprovalRegistry();

    registry.store('ur-agent__coding-agent', {
      conversationId: 'ur-agent__coding-agent',
      requestingParticipantId: 'coding-agent',
      callingParticipantId: 'ur-agent', // Expected: ur-agent
      requests: [
        { requestId: 'req-1', toolCallId: 'tc-1', toolName: 'file_write', toolArguments: {} },
      ],
      resume: async () => ({ status: 'success', response: 'done' }),
    });

    // Called by a DIFFERENT participant
    const context = {
      participant: { id: 'some-other-agent', approvalAuthority: {} },
      pendingApprovalRegistry: registry,
    } as unknown as RuntimeContext;

    const result = await approvalResponseTool.execute(
      { responses: [{ requestId: 'req-1', approved: true }] },
      context,
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('does not have authority');
  });

  it('returns error for empty responses array', async () => {
    const registry = new PendingApprovalRegistry();
    const context = {
      participant: callerParticipant,
      pendingApprovalRegistry: registry,
    } as unknown as RuntimeContext;

    const result = await approvalResponseTool.execute({ responses: [] }, context);
    expect(result.status).toBe('error');
  });

  it('surfaces further pending approvals when the agent hits more in a later iteration', async () => {
    const registry = new PendingApprovalRegistry();

    registry.store('ur-agent__coding-agent', {
      conversationId: 'ur-agent__coding-agent',
      requestingParticipantId: 'coding-agent',
      callingParticipantId: 'ur-agent',
      requests: [
        { requestId: 'req-1', toolCallId: 'tc-1', toolName: 'file_write', toolArguments: {} },
      ],
      resume: async () => ({
        status: 'approval_required' as const,
        pendingApprovals: {
          conversationId: 'ur-agent__coding-agent',
          requests: [
            { requestId: 'req-2', toolCallId: 'tc-2', toolName: 'process_exec', toolArguments: {} },
          ],
        },
      }),
    });

    const context = {
      participant: { ...callerParticipant },
      pendingApprovalRegistry: registry,
    } as unknown as RuntimeContext;

    const result = await approvalResponseTool.execute(
      { responses: [{ requestId: 'req-1', approved: true }] },
      context,
    );

    expect(result.status).toBe('approval_required');
    expect(result.data).toBeDefined();
    const data = result.data as { requests: Array<{ requestId: string }> };
    expect(data.requests[0].requestId).toBe('req-2');
  });
});

// ── communicate tool — pending check ───────────────────────────────────────

describe('communicate tool — pending approval state', () => {
  it('returns pending requests when conversation has unresolved approvals', async () => {
    const registry = new PendingApprovalRegistry();

    // Seed the registry with a pending batch for ur-agent→coding-agent
    const conversationId = 'ur-agent__coding-agent';
    registry.store(conversationId, {
      conversationId,
      requestingParticipantId: 'coding-agent',
      callingParticipantId: 'ur-agent',
      requests: [
        { requestId: 'req-1', toolCallId: 'tc-1', toolName: 'file_write', toolArguments: { path: 'src/x.ts' } },
      ],
      resume: async () => ({ status: 'success', response: 'done' }),
    });

    const context = {
      participant: { id: 'ur-agent', type: 'agent' },
      session: {
        data: { id: 'test-session' },
        collective: { get: () => codingAgent },
        send: async () => { throw new Error('Should not be called when pending'); },
      },
      pendingApprovalRegistry: registry,
      communicationDepth: 0,
    } as unknown as RuntimeContext;

    const result = await communicateTool.execute(
      { participantId: 'coding-agent', message: 'Are you done yet?' },
      context,
    );

    // Should return the pending requests without sending a new message
    expect(result.status).toBe('approval_required');
    const data = result.data as { conversationId: string; requests: Array<{ requestId: string }> };
    expect(data.conversationId).toBe(conversationId);
    expect(data.requests[0].requestId).toBe('req-1');
  });

  it('passes callingParticipantId downstream when sending normally', async () => {
    const registry = new PendingApprovalRegistry();

    let capturedContext: Partial<RuntimeContext> | null = null;

    const context = {
      participant: { id: 'ur-agent', type: 'agent' },
      session: {
        data: { id: 'test-session' },
        collective: { get: () => codingAgent },
        send: async (
          _from: string,
          _to: string,
          _msg: string,
          _name: undefined,
          ctx: Partial<RuntimeContext>,
        ) => {
          capturedContext = ctx;
          return { status: 'success', response: 'done' };
        },
      },
      pendingApprovalRegistry: registry,
      communicationDepth: 0,
    } as unknown as RuntimeContext;

    await communicateTool.execute(
      { participantId: 'coding-agent', message: 'Hello' },
      context,
    );

    expect(capturedContext).not.toBeNull();
    expect(capturedContext!.callingParticipantId).toBe('ur-agent');
    expect(capturedContext!.communicationDepth).toBe(1);
  });
});

// ── PendingApprovalRegistry ─────────────────────────────────────────────────

describe('PendingApprovalRegistry', () => {
  it('stores and retrieves a batch by conversationId', () => {
    const registry = new PendingApprovalRegistry();
    const batch = {
      conversationId: 'conv-1',
      requestingParticipantId: 'agent-b',
      callingParticipantId: 'agent-a',
      requests: [
        { requestId: 'req-1', toolCallId: 'tc-1', toolName: 'file_write', toolArguments: {} },
      ],
      resume: async () => ({ status: 'success' as const, response: 'done' }),
    };

    registry.store('conv-1', batch);
    expect(registry.hasPending('conv-1')).toBe(true);
    expect(registry.get('conv-1')).toBe(batch);
  });

  it('finds batch by requestId', () => {
    const registry = new PendingApprovalRegistry();
    const batch = {
      conversationId: 'conv-1',
      requestingParticipantId: 'agent-b',
      callingParticipantId: 'agent-a',
      requests: [
        { requestId: 'req-abc', toolCallId: 'tc-1', toolName: 'file_write', toolArguments: {} },
      ],
      resume: async () => ({ status: 'success' as const, response: 'done' }),
    };

    registry.store('conv-1', batch);
    expect(registry.getByRequestId('req-abc')).toBe(batch);
    expect(registry.getByRequestId('req-unknown')).toBeUndefined();
  });

  it('clears a batch and its request index', () => {
    const registry = new PendingApprovalRegistry();
    registry.store('conv-1', {
      conversationId: 'conv-1',
      requestingParticipantId: 'b',
      callingParticipantId: 'a',
      requests: [{ requestId: 'req-1', toolCallId: 'tc-1', toolName: 'f', toolArguments: {} }],
      resume: async () => ({ status: 'success' as const, response: '' }),
    });

    registry.clear('conv-1');
    expect(registry.hasPending('conv-1')).toBe(false);
    expect(registry.getByRequestId('req-1')).toBeUndefined();
  });

  it('replaces existing batch on re-store (cleans up old request index)', () => {
    const registry = new PendingApprovalRegistry();

    registry.store('conv-1', {
      conversationId: 'conv-1',
      requestingParticipantId: 'b',
      callingParticipantId: 'a',
      requests: [{ requestId: 'old-req', toolCallId: 'tc-1', toolName: 'f', toolArguments: {} }],
      resume: async () => ({ status: 'success' as const, response: '' }),
    });

    registry.store('conv-1', {
      conversationId: 'conv-1',
      requestingParticipantId: 'b',
      callingParticipantId: 'a',
      requests: [{ requestId: 'new-req', toolCallId: 'tc-2', toolName: 'f', toolArguments: {} }],
      resume: async () => ({ status: 'success' as const, response: '' }),
    });

    expect(registry.getByRequestId('old-req')).toBeUndefined();
    expect(registry.getByRequestId('new-req')).toBeDefined();
  });

  it('listPending returns all active conversation IDs', () => {
    const registry = new PendingApprovalRegistry();
    const makeBatch = (id: string) => ({
      conversationId: id,
      requestingParticipantId: 'b',
      callingParticipantId: 'a',
      requests: [],
      resume: async () => ({ status: 'success' as const, response: '' }),
    });

    registry.store('conv-1', makeBatch('conv-1'));
    registry.store('conv-2', makeBatch('conv-2'));
    const pending = registry.listPending();
    expect(pending).toHaveLength(2);
    expect(pending).toContain('conv-1');
    expect(pending).toContain('conv-2');
  });
});
