# Filesystem as Source of Truth — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Legion's state management so the `.legion/` filesystem is the single source of truth — all mutations write immediately, all reads come from disk, and the web UI derives its state from disk + WebSocket deltas.

**Architecture:** Conversation files become complete replay logs (every LLM turn, tool call, tool result persisted as it happens). Approvals are represented as messages within conversations. REST endpoints read from disk. The Collective reads participant configs from disk on demand. WebSocket events carry data payloads for incremental UI updates, with full REST loads on refresh.

**Tech Stack:** TypeScript, Vitest, Fastify, Vue 3 composables, core Storage class for file I/O

**Design doc:** `docs/plans/2025-03-07-filesystem-as-source-of-truth-design.md`

---

## Phase 1: Conversation Write-Through Persistence

### Task 1.1: Add `appendMessage()` to Conversation with Auto-Persist

**Files:**
- Modify: `packages/core/src/communication/Conversation.ts`
- Create: `packages/core/src/communication/Conversation.test.ts`

**Step 1: Write the failing test**

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Storage } from '../workspace/Storage.js';
import { Conversation, ConversationData } from './Conversation.js';
import { RuntimeRegistry } from '../runtime/RuntimeRegistry.js';
import { createMessage } from './Message.js';

describe('Conversation', () => {
  let tmpDir: string;
  let storage: Storage;
  let registry: RuntimeRegistry;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'legion-conv-test-'));
    storage = new Storage(tmpDir);
    registry = new RuntimeRegistry();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeConversation(data?: Partial<ConversationData>): Conversation {
    return new Conversation(
      {
        sessionId: 'test-session',
        initiatorId: 'user',
        targetId: 'agent',
        messages: [],
        createdAt: new Date().toISOString(),
        ...data,
      },
      storage,
      registry,
    );
  }

  describe('appendMessage', () => {
    it('appends message to data.messages and persists to disk', async () => {
      const conv = makeConversation();
      const msg = createMessage('user', 'user', 'hello');

      await conv.appendMessage(msg);

      // In-memory
      expect(conv.getMessages()).toHaveLength(1);
      expect(conv.getMessages()[0].content).toBe('hello');

      // On disk
      const onDisk = await storage.readJSON<ConversationData>(conv.filePath);
      expect(onDisk.messages).toHaveLength(1);
      expect(onDisk.messages[0].content).toBe('hello');
    });

    it('persists tool calls and tool results in messages', async () => {
      const conv = makeConversation();
      const assistantMsg = createMessage('assistant', 'agent', '', [
        { id: 'call_1', tool: 'file_read', args: { path: 'test.ts' } },
      ]);
      const toolResultMsg = createMessage('user', 'agent', '', undefined, [
        { toolCallId: 'call_1', tool: 'file_read', status: 'success', result: 'file contents' },
      ]);

      await conv.appendMessage(assistantMsg);
      await conv.appendMessage(toolResultMsg);

      const onDisk = await storage.readJSON<ConversationData>(conv.filePath);
      expect(onDisk.messages).toHaveLength(2);
      expect(onDisk.messages[0].toolCalls).toHaveLength(1);
      expect(onDisk.messages[1].toolResults).toHaveLength(1);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/communication/Conversation.test.ts`
Expected: FAIL — `appendMessage` is not a function

**Step 3: Implement `appendMessage()` on Conversation**

In `packages/core/src/communication/Conversation.ts`, add after the `getMessages()` method (after line 187):

```typescript
/**
 * Append a message and immediately persist to disk.
 * This is the primary mutation method — every state change writes through.
 */
async appendMessage(message: Message): Promise<void> {
  this.data.messages.push(message);
  await this.persist();
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/communication/Conversation.test.ts`
Expected: PASS

**Step 5: Run full test suite to check for regressions**

Run: `npm test`
Expected: All existing tests pass

**Step 6: Commit**

```bash
git add packages/core/src/communication/Conversation.ts packages/core/src/communication/Conversation.test.ts
git commit -m "feat(core): add appendMessage() with auto-persist to Conversation"
```

---

### Task 1.2: Refactor `Conversation.send()` to Use `appendMessage()`

**Files:**
- Modify: `packages/core/src/communication/Conversation.ts`
- Modify: `packages/core/src/communication/Conversation.test.ts`

**Step 1: Write the failing test**

Add to the existing test file:

```typescript
describe('send', () => {
  it('persists user message to disk before calling runtime', async () => {
    // Register a mock runtime that checks disk state when invoked
    const { MockRuntime } = await import('../runtime/MockRuntime.js');
    registry.register('mock', () => new MockRuntime());

    const conv = makeConversation({ targetId: 'mock-agent' });
    const mockTarget = {
      id: 'mock-agent',
      name: 'Mock',
      type: 'mock' as const,
      status: 'active' as const,
      responses: [{ trigger: '.*', response: 'reply' }],
    };

    // We need a minimal RuntimeContext
    const { EventBus } = await import('../events/EventBus.js');
    const { Session } = await import('./Session.js');
    const { ToolRegistry } = await import('../tools/ToolRegistry.js');
    const { Config } = await import('../config/Config.js');
    const { AuthEngine } = await import('../authorization/AuthEngine.js');
    const { PendingApprovalRegistry } = await import(
      '../authorization/PendingApprovalRegistry.js'
    );

    const eventBus = new EventBus();
    const context = {
      participant: mockTarget,
      conversation: conv,
      session: {} as InstanceType<typeof Session>,
      communicationDepth: 0,
      toolRegistry: new ToolRegistry(),
      config: new Config(tmpDir),
      eventBus,
      storage,
      authEngine: new AuthEngine({ eventBus }),
      pendingApprovalRegistry: new PendingApprovalRegistry(),
    };

    await conv.send('hello', mockTarget, context);

    // After send completes, conversation should be persisted with both messages
    const onDisk = await storage.readJSON<ConversationData>(conv.filePath);
    expect(onDisk.messages.length).toBeGreaterThanOrEqual(2);
    expect(onDisk.messages[0].content).toBe('hello');
    expect(onDisk.messages[0].role).toBe('user');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/communication/Conversation.test.ts`
Expected: May PASS or FAIL depending on timing — the test verifies the new contract.

**Step 3: Refactor `send()` to use `appendMessage()`**

In `Conversation.send()`, replace lines 137-139:

```typescript
// OLD:
this.data.messages.push(
  createMessage('user', this.data.initiatorId, message),
);

// NEW:
await this.appendMessage(
  createMessage('user', this.data.initiatorId, message),
);
```

And replace lines 160-164:

```typescript
// OLD:
if (result.response) {
  this.data.messages.push(
    createMessage('assistant', this.data.targetId, result.response),
  );
}

// NEW:
if (result.response) {
  await this.appendMessage(
    createMessage('assistant', this.data.targetId, result.response),
  );
}
```

Remove the standalone `persist()` call at line 167 (now redundant — each `appendMessage` persists).

**Step 4: Run tests to verify**

Run: `npx vitest run packages/core/src/communication/Conversation.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add packages/core/src/communication/Conversation.ts packages/core/src/communication/Conversation.test.ts
git commit -m "refactor(core): Conversation.send() uses appendMessage() for write-through persistence"
```

---

### Task 1.3: Refactor AgentRuntime to Persist Intermediate Messages

**Files:**
- Modify: `packages/core/src/runtime/AgentRuntime.ts`
- Modify: `packages/core/src/communication/Conversation.test.ts`

This is the key change: the agentic loop appends tool-call and tool-result messages to the Conversation (which persists them) instead of a private `workingMessages` array.

**Step 1: Write the failing test**

Add to Conversation.test.ts a test using MockRuntime with tool calls. Note: MockRuntime doesn't do tool calls, so we test at the AgentRuntime level. Add a new test file instead:

Create: `packages/core/src/runtime/AgentRuntime.test.ts`

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Storage } from '../workspace/Storage.js';
import { Conversation, ConversationData } from '../communication/Conversation.js';
import { RuntimeRegistry } from './RuntimeRegistry.js';
import { EventBus } from '../events/EventBus.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { Config } from '../config/Config.js';
import { AuthEngine } from '../authorization/AuthEngine.js';
import { PendingApprovalRegistry } from '../authorization/PendingApprovalRegistry.js';
import { Session } from '../communication/Session.js';
import { createMessage } from '../communication/Message.js';

describe('AgentRuntime — conversation persistence', () => {
  let tmpDir: string;
  let storage: Storage;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'legion-agent-test-'));
    storage = new Storage(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('persists intermediate tool call and result messages to conversation file', async () => {
    // This test verifies the contract: after AgentRuntime completes,
    // the conversation file on disk contains the full agentic loop messages
    // (assistant with toolCalls, user with toolResults, final assistant response).
    //
    // Implementation will require a mock LLM provider that returns tool calls
    // on the first turn and a text response on the second turn.
    // The exact test body will be refined during implementation based on
    // how the provider mock is structured.

    // Placeholder assertion — will be filled during implementation
    expect(true).toBe(true);
  });
});
```

Note: The exact mock LLM provider setup for this test is complex. The implementer should study `packages/core/src/runtime/approval-e2e.integration.test.ts` for the pattern of mocking LLM providers with tool-call responses, and adapt it here. The key assertion is: after `conversation.send()` completes, `storage.readJSON(conv.filePath)` should contain messages with `toolCalls` and `toolResults` arrays, not just the initial user message and final text response.

**Step 2: Modify AgentRuntime.runLoop()**

In `packages/core/src/runtime/AgentRuntime.ts`:

**Change the method signature** to accept the Conversation:

At the top of `handleMessage()` (line ~55), change how `workingMessages` is built:

```typescript
// OLD (line 55):
const workingMessages: Message[] = [...context.conversation.getMessages()];

// NEW: read messages from the conversation (which is persisted)
// The agentic loop will append directly to the conversation
```

In `runLoop()`, wherever `workingMessages.push(assistantMessage)` appears (line ~132):

```typescript
// OLD:
workingMessages.push(assistantMessage);

// NEW:
await context.conversation.appendMessage(assistantMessage);
```

And wherever `workingMessages.push(toolResultMessage)` appears (line ~402):

```typescript
// OLD:
workingMessages.push(toolResultMessage);

// NEW:
await context.conversation.appendMessage(toolResultMessage);
```

Replace `workingMessages` references in the LLM call with `context.conversation.getMessages()`:

```typescript
// OLD (line 104):
const response = await provider.chat(workingMessages, { ... });

// NEW:
const response = await provider.chat([...context.conversation.getMessages()], { ... });
```

Remove the `workingMessages` parameter from `runLoop()` entirely — the conversation IS the message list now.

**Step 3: Update `Conversation.send()` to NOT append the final response**

Since AgentRuntime now appends all messages (including the final text response) via `appendMessage()`, `Conversation.send()` should NOT also append the response — that would duplicate it.

However, only AgentRuntime appends during the loop. Other runtimes (MockRuntime, REPLRuntime, WebRuntime) return a result and expect `Conversation.send()` to append it. So we need a way to distinguish.

**Approach**: Add a flag to RuntimeResult indicating the runtime already persisted its messages:

In `packages/core/src/runtime/ParticipantRuntime.ts`, add to RuntimeResult:

```typescript
export interface RuntimeResult {
  status: 'success' | 'error' | 'approval_required';
  response?: string;
  error?: string;
  // ... existing fields ...
  /** If true, the runtime already appended all messages to the conversation */
  messagesPersisted?: boolean;
}
```

AgentRuntime sets `messagesPersisted: true` on its return. `Conversation.send()` checks this flag:

```typescript
// In Conversation.send(), replace the response-append block:
if (result.response && !result.messagesPersisted) {
  await this.appendMessage(
    createMessage('assistant', this.data.targetId, result.response),
  );
}
```

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass. Existing tests may need adjustment if they assert on conversation message counts (since conversations now contain more messages).

**Step 5: Commit**

```bash
git add packages/core/src/runtime/AgentRuntime.ts packages/core/src/runtime/ParticipantRuntime.ts packages/core/src/communication/Conversation.ts packages/core/src/runtime/AgentRuntime.test.ts
git commit -m "feat(core): AgentRuntime persists full agentic loop to conversation file"
```

---

### Task 1.4: Verify CLI Still Works

**Files:** No code changes — manual/automated verification

**Step 1: Build all packages**

Run: `npm run build`
Expected: Clean build, no errors

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Run lint**

Run: `npm run lint`
Expected: No lint errors

**Step 4: Commit if any fixups needed**

---

## Phase 2: Approvals as Conversation Messages

### Task 2.1: Add `approval_pending` Status to ToolCallResult

**Files:**
- Modify: `packages/core/src/tools/Tool.ts`

**Step 1: Update the ToolCallResult status union**

In `packages/core/src/tools/Tool.ts` line 82, extend the status type:

```typescript
// OLD:
status: 'success' | 'error' | 'approval_required' | 'rejected';

// NEW:
status: 'success' | 'error' | 'approval_required' | 'approval_pending' | 'rejected';
```

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (additive change)

**Step 3: Commit**

```bash
git add packages/core/src/tools/Tool.ts
git commit -m "feat(core): add approval_pending status to ToolCallResult"
```

---

### Task 2.2: Persist Approval State to Conversation

**Files:**
- Modify: `packages/core/src/runtime/AgentRuntime.ts`
- Create or extend: `packages/core/src/runtime/AgentRuntime.test.ts`

When the agentic loop encounters tools that require approval and builds a `pendingApprovals` batch (AgentRuntime.ts around lines 248-380), it should also append an `approval_pending` tool result message to the conversation before returning.

**Step 1: Write the failing test**

Add to `AgentRuntime.test.ts`:

```typescript
it('persists approval_pending tool results to conversation when tools require approval', async () => {
  // Test that when AgentRuntime encounters a tool requiring approval,
  // the conversation file on disk contains a message with toolResults
  // where status is 'approval_pending'.
  //
  // The implementer should use the pattern from approval-e2e.integration.test.ts
  // with a mock provider that returns tool calls for approval-requiring tools.
  expect(true).toBe(true); // Placeholder — refine during implementation
});
```

**Step 2: Modify the held-calls path in AgentRuntime.runLoop()**

In the section around lines 248-380 where `heldCalls.length > 0`:

Before returning `{ status: 'approval_required', ... }`, append the pending state to conversation:

```typescript
// Build approval_pending tool results for the held calls
const pendingToolResults: ToolCallResult[] = heldCalls.map((tc) => ({
  toolCallId: tc.id,
  tool: tc.name,
  status: 'approval_pending' as const,
  result: JSON.stringify({
    approvalId: pendingRequests.find((r) => r.toolCallId === tc.id)?.requestId,
    arguments: tc.arguments,
  }),
}));

// Merge with already-executed results
const allResults = response.toolCalls.map((tc) => {
  const pending = pendingToolResults.find((r) => r.toolCallId === tc.id);
  if (pending) return pending;
  const executed = resultMap.get(tc.id);
  return executed ?? {
    toolCallId: tc.id,
    tool: tc.name,
    status: 'error' as const,
    result: `No result for ${tc.id}`,
  };
});

// Persist to conversation
await context.conversation.appendMessage(
  createMessage('user', agentConfig.id, '', undefined, allResults),
);
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/core/src/runtime/AgentRuntime.ts packages/core/src/runtime/AgentRuntime.test.ts
git commit -m "feat(core): persist approval_pending state to conversation file"
```

---

## Phase 3: Communicate Tool `conversationRef`

### Task 3.1: Add `conversationRef` to Communicate Tool Result

**Files:**
- Modify: `packages/core/src/tools/communicate.ts`
- Extend: `packages/core/src/tools/collective-tools.test.ts` or create `packages/core/src/tools/communicate.test.ts`

**Step 1: Write the failing test**

```typescript
it('includes conversationRef in successful communicate result data', async () => {
  // Set up a communicate tool execution with a mock session that returns a response.
  // Assert that the result.data is an object with a conversationRef field
  // matching the format "{callerParticipantId}__{targetParticipantId}".
  expect(true).toBe(true); // Placeholder — refine during implementation
});
```

**Step 2: Modify communicate tool execute()**

In `packages/core/src/tools/communicate.ts`, around lines 118-122, change the normal return path:

```typescript
// OLD:
return { status: result.status, data: result.response, error: result.error };

// NEW:
const conversationRef = `${callerParticipantId}__${participantId}`;
return {
  status: result.status,
  data: result.status === 'success'
    ? JSON.stringify({ response: result.response, conversationRef })
    : result.response,
  error: result.error,
};
```

Note: The `data` field on `ToolResult` is `unknown`, and gets stringified for the LLM via `ToolCallResult.result`. The conversationRef is embedded in the structured data so it can be parsed by the UI from the persisted conversation file, while the LLM just sees it as part of the tool result text.

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass (may need to update existing communicate tool tests if they assert on exact result.data format)

**Step 4: Commit**

```bash
git add packages/core/src/tools/communicate.ts
git commit -m "feat(core): communicate tool includes conversationRef in result data"
```

---

## Phase 4: Disk-First Reads

### Task 4.1: Refactor Collective to Read from Disk on Demand

**Files:**
- Modify: `packages/core/src/collective/Collective.ts`
- Create: `packages/core/src/collective/Collective.test.ts`

**Step 1: Write tests for disk-first behavior**

```typescript
describe('Collective — disk-first reads', () => {
  it('get() reads from disk, not from a cached map', async () => {
    const collective = new Collective(storage);
    // Save a participant to disk
    await storage.writeJSON('collective/participants/test-agent.json', {
      id: 'test-agent', name: 'Test', type: 'agent', status: 'active',
    });
    // Read it without prior load()
    const participant = await collective.get('test-agent');
    expect(participant).toBeDefined();
    expect(participant!.name).toBe('Test');
  });

  it('reflects external file changes on next read', async () => {
    const collective = new Collective(storage);
    await storage.writeJSON('collective/participants/test-agent.json', {
      id: 'test-agent', name: 'Original', type: 'agent', status: 'active',
    });
    // First read
    const p1 = await collective.get('test-agent');
    expect(p1!.name).toBe('Original');
    // External change
    await storage.writeJSON('collective/participants/test-agent.json', {
      id: 'test-agent', name: 'Updated', type: 'agent', status: 'active',
    });
    // Second read sees the change
    const p2 = await collective.get('test-agent');
    expect(p2!.name).toBe('Updated');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/collective/Collective.test.ts`
Expected: FAIL — current `get()` reads from memory map, not disk

**Step 3: Refactor Collective**

Change `get()` to read from disk:

```typescript
async get(id: string): Promise<ParticipantConfig | undefined> {
  const filePath = `collective/participants/${id}.json`;
  if (await this.storage.exists(filePath)) {
    return this.storage.readJSON<ParticipantConfig>(filePath);
  }
  return undefined;
}
```

Change `list()` to glob disk:

```typescript
async list(filter?: { type?: string; status?: string }): Promise<ParticipantConfig[]> {
  const files = await this.storage.list('collective/participants');
  const participants: ParticipantConfig[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const p = await this.storage.readJSON<ParticipantConfig>(`collective/participants/${file}`);
    if (filter?.type && p.type !== filter.type) continue;
    if (filter?.status && p.status !== filter.status) continue;
    participants.push(p);
  }
  return participants;
}
```

Note: `get()` and `list()` become async if they aren't already. This will require updating all call sites. The implementer should search for all usages of `collective.get(`, `collective.list(`, `collective.getOrThrow(` and add `await` where needed.

**Step 4: Run full test suite, fix call sites**

Run: `npm test`
Fix any failures from `get()`/`list()` now being async.

**Step 5: Commit**

```bash
git add packages/core/src/collective/Collective.ts packages/core/src/collective/Collective.test.ts
git commit -m "refactor(core): Collective reads participant configs from disk on demand"
```

---

### Task 4.2: Refactor Server REST Endpoints to Read from Disk

**Files:**
- Modify: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/src/routes/collective.ts`
- Modify: `packages/server/src/routes/approvals.ts`

**Step 1: Update session conversation endpoints**

In `sessions.ts`, the `GET /sessions/:id/conversations` endpoint should read conversation files from disk via Storage instead of from the in-memory Session object.

```typescript
// Read conversations from disk
const convDir = `sessions/${sessionId}/conversations`;
if (await storage.exists(convDir)) {
  const files = await storage.list(convDir);
  const conversations = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const data = await storage.readJSON(`${convDir}/${file}`);
    conversations.push(data);
  }
  return conversations;
}
return [];
```

Similarly for `GET /sessions/:id/conversations/:convId/messages` — read from the specific conversation file on disk.

**Step 2: Update collective endpoints**

These should already work since Collective was refactored in Task 4.1 to read from disk. Verify the route handlers correctly `await` the now-async methods.

**Step 3: Update approvals endpoint**

`GET /approvals/pending` should scan conversation files for `approval_pending` status instead of reading from the in-memory `PendingApprovalRegistry`. However, for performance in Phase 4, keep the registry as the source for this endpoint and note it as a future simplification.

**Step 4: Run server tests**

Run: `npx vitest run packages/server/src/server.test.ts`
Expected: Tests pass (may need updates for async changes)

**Step 5: Commit**

```bash
git add packages/server/src/routes/sessions.ts packages/server/src/routes/collective.ts packages/server/src/routes/approvals.ts
git commit -m "refactor(server): REST endpoints read from disk via Storage"
```

---

## Phase 5: Web UI Simplification

### Task 5.1: Update WebSocket Bridge to Emit Data Payloads

**Files:**
- Modify: `packages/server/src/websocket/bridge.ts`

**Step 1: Enhance the bridge to include conversation data in events**

The bridge currently wraps raw EventBus events. For `conversation:updated` type events, it should include the message that was just appended.

Since `appendMessage()` persists and then core code emits events, we need Conversation to emit an event when a message is appended. Add to `Conversation.appendMessage()`:

```typescript
async appendMessage(message: Message, eventBus?: EventBus): Promise<void> {
  this.data.messages.push(message);
  await this.persist();
  if (eventBus) {
    eventBus.emit({
      type: 'conversation:updated',
      sessionId: this.data.sessionId,
      conversationId: `${this.data.initiatorId}__${this.data.targetId}`,
      message,
      timestamp: new Date(),
    });
  }
}
```

The bridge already forwards all events via `eventBus.onAny()`, so `conversation:updated` events with the message payload will automatically reach WebSocket clients.

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/core/src/communication/Conversation.ts packages/server/src/websocket/bridge.ts
git commit -m "feat: emit conversation:updated events with message payload on appendMessage"
```

---

### Task 5.2: Refactor `useSession` Composable for Hybrid Model

**Files:**
- Modify: `packages/server/web/src/composables/useSession.ts`

**Step 1: Add REST-based conversation loading**

Add a function to load a single conversation from REST:

```typescript
async function loadConversation(conversationId: string): Promise<void> {
  if (!session.value) return;
  const data = await api.get<ConversationData>(
    `/sessions/${session.value.id}/conversations/${conversationId}`,
  );
  const key = `${data.initiatorId}__${data.targetId}`;
  messages.set(key, data.messages ?? []);
}
```

**Step 2: Update WebSocket handler to use `conversation:updated` events**

Replace the current event-by-event state reconstruction with:

```typescript
case 'conversation:updated': {
  const convId = data['conversationId'] as string;
  const msg = data['message'] as Message;
  if (convId && msg) {
    // Incremental update — append the new message
    const existing = messages.get(convId) ?? [];
    existing.push(msg);
    messages.set(convId, existing);
  }
  break;
}
```

**Step 3: Derive pending approvals from messages**

Replace the `pendingApprovals` array with a computed property:

```typescript
const pendingApprovals = computed(() => {
  const pending: ApprovalRequest[] = [];
  for (const [convId, msgs] of messages.entries()) {
    for (const msg of msgs) {
      if (!msg.toolResults) continue;
      for (const tr of msg.toolResults) {
        if (tr.status === 'approval_pending') {
          const parsed = JSON.parse(tr.result);
          pending.push({
            requestId: parsed.approvalId,
            participantId: convId.split('__')[1],
            toolName: tr.tool,
            arguments: parsed.arguments,
          });
        }
      }
    }
  }
  return pending;
});
```

**Step 4: On page refresh, full REST load populates everything**

The existing `loadSession()` → `loadConversations()` flow already does this. Since conversations now contain tool calls/results/approvals, the full state is recovered from disk.

**Step 5: Run web tests**

Run: `cd packages/server/web && npx vitest run`
Expected: Tests pass (some may need updates for new event types)

**Step 6: Commit**

```bash
git add packages/server/web/src/composables/useSession.ts
git commit -m "refactor(web): useSession uses hybrid WebSocket + REST model with disk-derived state"
```

---

### Task 5.3: Update Chat UI to Show Tool Calls and Nested Conversations

**Files:**
- Modify: `packages/server/web/src/components/chat/ChatPanel.vue`
- Modify or create: `packages/server/web/src/components/chat/MessageBubble.vue`

**Step 1: Update message rendering to show tool calls**

Messages now include `toolCalls` and `toolResults` arrays. The chat UI should render these inline — showing what tool was called, with what arguments, and what the result was.

For `conversationRef` in communicate tool results: render an expandable link that loads the child conversation on click.

The exact UI design should follow the CLI's display pattern. The implementer should study:
- `packages/cli/src/repl/display.ts` — how the CLI renders tool calls and results
- The existing `MessageBubble.vue` component for the current rendering approach

**Step 2: Update ApprovalCard to work with conversation-derived approvals**

Since approvals are now derived from conversation messages, the `ApprovalCard` should work the same way but be tied to a specific conversation rather than being a global floating dialog. It should appear inline in the message flow where the `approval_pending` tool result exists.

**Step 3: Run web tests and visual check**

Run: `cd packages/server/web && npx vitest run`
Check the UI visually by running the dev server.

**Step 4: Commit**

```bash
git add packages/server/web/src/components/chat/
git commit -m "feat(web): render tool calls, results, and nested conversation links in chat UI"
```

---

### Task 5.4: Final Integration Testing

**Files:** No new code — verification only

**Step 1: Build everything**

```bash
npm run build
cd packages/server/web && npm run build
```

**Step 2: Run all tests**

```bash
npm test
cd packages/server/web && npx vitest run
```

**Step 3: Run lint and format check**

```bash
npm run lint
npm run format:check
```

**Step 4: Manual verification**

Start the server and web UI. Verify:
1. Send a message to an agent — see tool calls and results appear in real-time
2. Refresh the page — all messages including tool calls/results are still visible
3. Pending approvals survive page refresh
4. Agent-to-agent conversations show `conversationRef` links
5. Config changes are reflected immediately on next agent interaction

**Step 5: Commit any remaining fixups**

```bash
git commit -m "chore: final integration fixes for filesystem-as-source-of-truth refactor"
```

---

## Summary of All Files Changed

### Core (`packages/core/src/`)
| File | Action | Task |
|------|--------|------|
| `communication/Conversation.ts` | Modify — add `appendMessage()`, refactor `send()` | 1.1, 1.2, 5.1 |
| `communication/Conversation.test.ts` | Create — tests for appendMessage, send persistence | 1.1, 1.2 |
| `communication/Message.ts` | No changes needed | — |
| `runtime/AgentRuntime.ts` | Modify — append to conversation instead of workingMessages | 1.3, 2.2 |
| `runtime/AgentRuntime.test.ts` | Create — tests for intermediate message persistence | 1.3, 2.2 |
| `runtime/ParticipantRuntime.ts` | Modify — add `messagesPersisted` to RuntimeResult | 1.3 |
| `tools/Tool.ts` | Modify — add `approval_pending` status | 2.1 |
| `tools/communicate.ts` | Modify — add `conversationRef` to result data | 3.1 |
| `collective/Collective.ts` | Modify — disk-first reads | 4.1 |
| `collective/Collective.test.ts` | Create — tests for disk-first behavior | 4.1 |

### Server (`packages/server/src/`)
| File | Action | Task |
|------|--------|------|
| `routes/sessions.ts` | Modify — read from disk via Storage | 4.2 |
| `routes/collective.ts` | Modify — await async Collective methods | 4.2 |
| `routes/approvals.ts` | Modify — minor updates | 4.2 |
| `websocket/bridge.ts` | Verify — already forwards all events | 5.1 |

### Web UI (`packages/server/web/src/`)
| File | Action | Task |
|------|--------|------|
| `composables/useSession.ts` | Modify — hybrid model, derived approvals | 5.2 |
| `components/chat/ChatPanel.vue` | Modify — render tool calls, inline approvals | 5.3 |
| `components/chat/MessageBubble.vue` | Modify — show toolCalls/toolResults | 5.3 |
| `components/chat/ApprovalCard.vue` | Modify — work with conversation-derived state | 5.3 |
