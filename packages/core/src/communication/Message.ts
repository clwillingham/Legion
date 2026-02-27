import type { ToolCall, ToolCallResult } from '../tools/Tool.js';

/**
 * Canonical message format — Legion's internal representation.
 *
 * This format is provider-independent. At LLM call time, MessageTranslator
 * converts these to the target provider's format (Anthropic, OpenAI, etc.).
 *
 * In a Conversation:
 * - 'user' role = the initiating participant
 * - 'assistant' role = the target participant
 */
export interface Message {
  /** Role in the conversation context */
  role: 'user' | 'assistant';

  /** Which participant produced this message */
  participantId: string;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Text content of the message */
  content: string;

  /** Tool calls made by this participant (assistant messages only) */
  toolCalls?: ToolCall[];

  /** Results from tool execution (fed back to the LLM) */
  toolResults?: ToolCallResult[];
}

/**
 * Create a new message with the current timestamp.
 */
export function createMessage(
  role: 'user' | 'assistant',
  participantId: string,
  content: string,
  toolCalls?: ToolCall[],
  toolResults?: ToolCallResult[],
): Message {
  return {
    role,
    participantId,
    timestamp: new Date().toISOString(),
    content,
    toolCalls,
    toolResults,
  };
}
