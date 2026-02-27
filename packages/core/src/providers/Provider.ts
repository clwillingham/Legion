import type { Message } from '../communication/Message.js';
import type { JSONSchema } from '../tools/Tool.js';

/**
 * LLMProvider — abstract interface for LLM API providers.
 *
 * Each provider (Anthropic, OpenAI, OpenRouter) implements this interface.
 * Messages are passed in canonical format; the provider is responsible
 * for translating to its own wire format.
 */
export interface LLMProvider {
  /** Provider identifier (e.g. 'anthropic', 'openai', 'openrouter'). */
  readonly name: string;

  /**
   * Send a chat completion request.
   *
   * @param messages - Conversation history in canonical format.
   * @param options - Provider-agnostic request options.
   * @returns The assistant's response in canonical format.
   */
  chat(messages: Message[], options: ChatOptions): Promise<ChatResponse>;
}

/**
 * Options passed to LLMProvider.chat().
 */
export interface ChatOptions {
  /** Model identifier (e.g. 'claude-sonnet-4-20250514', 'gpt-4o'). */
  model: string;

  /** System prompt. */
  systemPrompt?: string;

  /** Tool definitions to make available. */
  tools?: ToolDefinition[];

  /** Temperature (0-2). */
  temperature?: number;

  /** Maximum tokens in the response. */
  maxTokens?: number;

  /** Stop sequences. */
  stopSequences?: string[];
}

/**
 * A tool definition passed to the LLM.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/**
 * Response from LLMProvider.chat().
 */
export interface ChatResponse {
  /** The assistant's text content (may be empty if only tool calls). */
  content: string;

  /** Tool calls requested by the model. */
  toolCalls: ChatToolCall[];

  /** Finish reason. */
  finishReason: 'stop' | 'tool_use' | 'max_tokens' | 'unknown';

  /** Token usage information. */
  usage?: TokenUsage;
}

/**
 * A tool call from the LLM response.
 */
export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Token usage statistics.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Configuration for an LLM provider.
 */
export interface ProviderConfig {
  /** Provider type. */
  provider: 'anthropic' | 'openai' | 'openrouter';

  /** API key. */
  apiKey: string;

  /** Base URL override (used by OpenRouter, or custom endpoints). */
  baseUrl?: string;

  /** Default model for this provider. */
  defaultModel?: string;
}
