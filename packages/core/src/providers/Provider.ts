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

  /**
   * List available models from this provider.
   *
   * @param options - Filtering, sorting, and pagination options.
   * @returns Paginated list of models with metadata.
   */
  listModels?(options?: ListModelsOptions): Promise<ListModelsResult>;
}

// ============================================================
// Model listing types
// ============================================================

/**
 * Pricing information for an LLM model (USD per million tokens).
 */
export interface ModelPricing {
  /** USD per million input tokens. */
  promptPerMTok: number;
  /** USD per million output tokens. */
  completionPerMTok: number;
  /** USD per million cached input token reads. */
  cacheReadPerMTok?: number;
  /** USD per million cached input token writes. */
  cacheWritePerMTok?: number;
}

/**
 * Canonical model information returned by listModels().
 */
export interface ModelInfo {
  /** Model identifier used in API requests (e.g. "claude-sonnet-4-6"). */
  id: string;
  /** Human-readable display name (e.g. "Claude Sonnet 4.6"). */
  name: string;
  /** Provider identifier (e.g. "anthropic", "openai", "openrouter"). */
  provider: string;
  /** Description of the model's capabilities. */
  description?: string;
  /** Maximum context window in tokens. */
  contextLength?: number;
  /** Pricing per million tokens. */
  pricing?: ModelPricing;
  /** ISO date when the model was created/added. */
  created?: string;
  /** Supported input/output modalities. */
  modalities?: { input: string[]; output: string[] };
  /** Supported API parameters (e.g. "tools", "temperature"). */
  supportedParameters?: string[];
}

/**
 * Options for filtering, sorting, and paginating model lists.
 */
export interface ListModelsOptions {
  /** Filter by name/id substring (case-insensitive). */
  search?: string;
  /** Sort results by this field. Default: 'name'. */
  sortBy?: 'name' | 'price_prompt' | 'price_completion' | 'context_length' | 'created';
  /** Sort direction. Default: 'asc'. */
  sortOrder?: 'asc' | 'desc';
  /** Maximum models to return (default 20). */
  limit?: number;
  /** Pagination offset (default 0). */
  offset?: number;
  /** OpenRouter-specific category filter. */
  category?: string;
}

/**
 * Paginated result from listModels().
 */
export interface ListModelsResult {
  /** Current page of model results. */
  models: ModelInfo[];
  /** Total number of matching models (before limit/offset). */
  total: number;
  /** Limit that was applied. */
  limit: number;
  /** Offset that was applied. */
  offset: number;
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
