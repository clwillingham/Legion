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
