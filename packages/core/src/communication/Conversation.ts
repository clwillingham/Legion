import { Message, createMessage } from './Message.js';
import { RuntimeRegistry } from '../runtime/RuntimeRegistry.js';
import type { RuntimeContext, RuntimeResult } from '../runtime/ParticipantRuntime.js';
import type { ParticipantConfig } from '../collective/Participant.js';
import type { Storage } from '../workspace/Storage.js';

/**
 * Conversation data — what gets persisted to disk.
 */
export interface ConversationData {
  /** The session this conversation belongs to */
  sessionId: string;

  /** The participant who initiated (has 'user' role) */
  initiatorId: string;

  /** The target participant (has 'assistant' role) */
  targetId: string;

  /** Optional name for parallel workstreams */
  name?: string;

  /** The message log */
  messages: Message[];

  /** When this conversation was created */
  createdAt: string;
}

/**
 * Simple async lock to prevent concurrent writes to the same conversation.
 */
class AsyncLock {
  private locked = false;
  private waitQueue: Array<(value: boolean) => void> = [];

  async tryAcquire(): Promise<boolean> {
    if (!this.locked) {
      this.locked = true;
      return true;
    }
    return false;
  }

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.locked = true;
        resolve();
        return true;
      });
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      next?.(true);
    } else {
      this.locked = false;
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }
}

/**
 * Conversation — a directional message log between exactly two participants.
 *
 * The initiator always has the 'user' role, the target always has the 'assistant' role.
 * If the same two participants communicate in the opposite direction, that is a
 * separate Conversation with roles flipped.
 *
 * Responsibilities:
 * 1. Acquire lock (or return 'busy' error)
 * 2. Append 'user' message to history
 * 3. Resolve target's ParticipantRuntime via RuntimeRegistry
 * 4. Call runtime.handleMessage(message, context)
 * 5. Append 'assistant' response to history
 * 6. Persist to disk
 * 7. Release lock
 * 8. Return result
 */
export class Conversation {
  readonly data: ConversationData;
  private lock: AsyncLock = new AsyncLock();
  private storage: Storage;
  private runtimeRegistry: RuntimeRegistry;

  constructor(data: ConversationData, storage: Storage, runtimeRegistry: RuntimeRegistry) {
    this.data = data;
    this.storage = storage;
    this.runtimeRegistry = runtimeRegistry;
  }

  /**
   * The file path for persisting this conversation within .legion/
   */
  get filePath(): string {
    const parts = [this.data.initiatorId, this.data.targetId];
    if (this.data.name) {
      parts.push(this.data.name);
    }
    return `sessions/${this.data.sessionId}/conversations/${parts.join('__')}.json`;
  }

  /**
   * Send a message in this conversation.
   *
   * Acquires the lock, appends the user message, invokes the target's runtime,
   * appends the response, persists, and returns.
   */
  async send(
    message: string,
    target: ParticipantConfig,
    context: RuntimeContext,
  ): Promise<RuntimeResult> {
    // Try to acquire lock
    if (!(await this.lock.tryAcquire())) {
      return {
        status: 'error',
        error:
          `Conversation with ${this.data.targetId} is currently busy. ` +
          `Try using a named conversation or wait and retry.`,
      };
    }

    try {
      // 1. Append user message to history
      this.data.messages.push(
        createMessage('user', this.data.initiatorId, message),
      );

      // 2. Emit event
      context.eventBus.emit({
        type: 'message:sent',
        sessionId: this.data.sessionId,
        fromParticipantId: this.data.initiatorId,
        toParticipantId: this.data.targetId,
        content: message,
        timestamp: new Date(),
      });

      // 3. Resolve target's runtime and invoke handleMessage
      const runtime = this.runtimeRegistry.resolve(target);
      const result = await runtime.handleMessage(message, {
        ...context,
        participant: target,
        conversation: this,
      });

      // 4. Append assistant response to history
      if (result.response) {
        this.data.messages.push(
          createMessage('assistant', this.data.targetId, result.response),
        );
      }

      // 5. Persist to disk
      await this.persist();

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: `Conversation error: ${errorMessage}`,
      };
    } finally {
      // 6. Release lock
      this.lock.release();
    }
  }

  /**
   * Get all messages in this conversation.
   */
  getMessages(): ReadonlyArray<Message> {
    return this.data.messages;
  }

  /**
   * Persist conversation data to disk.
   */
  async persist(): Promise<void> {
    await this.storage.writeJSON(this.filePath, this.data);
  }

  /**
   * Check if this conversation is currently locked.
   */
  get isBusy(): boolean {
    return this.lock.isLocked;
  }
}
