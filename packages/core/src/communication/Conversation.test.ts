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

  describe('send', () => {
    it('persists user message and response to disk after send', async () => {
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
