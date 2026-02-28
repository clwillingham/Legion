import type {
  LLMProvider,
  ChatOptions,
  ChatResponse,
  ProviderConfig,
  ListModelsOptions,
  ListModelsResult,
  ModelInfo,
} from './Provider.js';
import type { Message } from '../communication/Message.js';
import { toOpenAIMessages, toOpenAITools } from './MessageTranslator.js';
import {
  getKnownModel,
  getKnownModelsForProvider,
  filterAndPaginateModels,
} from './known-models.js';

/**
 * OpenAIProvider — LLM provider for the OpenAI Chat Completions API.
 *
 * Uses the openai SDK package (optional peer dependency).
 * Translates canonical messages to OpenAI format via MessageTranslator.
 *
 * Also used as the base for OpenRouter (OpenAI-compatible API).
 */
/** Prefixes of OpenAI model IDs to exclude from chat-relevant listings. */
const OPENAI_EXCLUDED_PREFIXES = [
  'whisper', 'dall-e', 'tts', 'text-embedding',
  'davinci', 'babbage', 'canary', 'codex',
];

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  private config: ProviderConfig;
  private clientPromise: Promise<any> | null = null;
  private modelCache: { data: ModelInfo[]; expiry: number } | null = null;
  private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: ProviderConfig, name?: string) {
    this.config = config;
    this.name = name ?? 'openai';
  }

  /**
   * Lazily initialize the OpenAI client (dynamic import).
   */
  private async getClient(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        let mod: any;
        try {
          mod = await import(
            /* webpackIgnore: true */ 'openai' as string
          );
        } catch {
          const pkgHint = this.name === 'openrouter'
            ? 'Install it with: npm install openai  (OpenRouter uses the OpenAI SDK)'
            : 'Install it with: npm install openai';
          throw new Error(
            `The openai package is required to use the ${this.name} provider.\n${pkgHint}`,
          );
        }
        const OpenAI = (mod.default ?? mod) as any;
        return new OpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseUrl,
        });
      })();
    }
    return this.clientPromise;
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const client = await this.getClient();

    // Translate to OpenAI format (system prompt is embedded as first message)
    const openaiMessages = toOpenAIMessages(messages, options.systemPrompt);
    const tools = options.tools?.length
      ? toOpenAITools(options.tools)
      : undefined;

    // Build request
    const request: Record<string, unknown> = {
      model: options.model || this.config.defaultModel || 'gpt-4o',
      messages: openaiMessages,
    };

    if (tools) {
      request.tools = tools;
    }
    if (options.temperature !== undefined) {
      request.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      request.max_tokens = options.maxTokens;
    }
    if (options.stopSequences?.length) {
      request.stop = options.stopSequences;
    }

    const response = await client.chat.completions.create(request);

    const choice = response.choices?.[0];
    if (!choice) {
      return {
        content: '',
        toolCalls: [],
        finishReason: 'unknown',
      };
    }

    // Parse tool calls
    const toolCalls: ChatResponse['toolCalls'] =
      choice.message.tool_calls?.map(
        (tc: { id: string; function: { name: string; arguments: string } }) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: safeParseJSON(tc.function.arguments),
        }),
      ) ?? [];

    // Map OpenAI finish reasons to our canonical format
    const finishReason = mapOpenAIFinishReason(choice.finish_reason);

    return {
      content: choice.message.content ?? '',
      toolCalls,
      finishReason,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async listModels(options: ListModelsOptions = {}): Promise<ListModelsResult> {
    const allModels = await this.fetchModelsWithCache();
    return filterAndPaginateModels(allModels, options);
  }

  /**
   * Fetch models from the OpenAI API, filtered to chat-relevant models
   * and enriched with known metadata. Cached with a 5-minute TTL.
   */
  private async fetchModelsWithCache(): Promise<ModelInfo[]> {
    if (this.modelCache && Date.now() < this.modelCache.expiry) {
      return this.modelCache.data;
    }

    let models: ModelInfo[];
    try {
      const client = await this.getClient();
      const response = await client.models.list();

      // Collect all models from the response (may be paginated/async iterable)
      const rawModels: Array<{ id: string; created?: number; owned_by?: string }> = [];
      if (Symbol.asyncIterator in response) {
        for await (const m of response) {
          rawModels.push(m as { id: string; created?: number; owned_by?: string });
        }
      } else {
        const data = (response as { data?: unknown[] }).data ?? [];
        rawModels.push(...(data as Array<{ id: string; created?: number; owned_by?: string }>));
      }

      // Filter out non-chat models
      const chatModels = rawModels.filter(
        (m) => !OPENAI_EXCLUDED_PREFIXES.some((prefix) => m.id.startsWith(prefix)),
      );

      models = chatModels.map((m) => {
        const known = getKnownModel(m.id);
        return {
          id: m.id,
          name: known?.name ?? m.id,
          provider: this.name,
          description: known?.description,
          contextLength: known?.contextLength,
          pricing: known?.pricing,
          created: m.created
            ? new Date(m.created * 1000).toISOString()
            : undefined,
        };
      });
    } catch {
      // If API call fails, fall back to known models only
      models = getKnownModelsForProvider('openai');
    }

    this.modelCache = { data: models, expiry: Date.now() + OpenAIProvider.CACHE_TTL_MS };
    return models;
  }
}

function mapOpenAIFinishReason(
  reason: string | null | undefined,
): ChatResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'unknown';
  }
}

function safeParseJSON(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return { raw: str };
  }
}
