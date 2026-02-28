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
import { toAnthropicMessages, toAnthropicTools } from './MessageTranslator.js';
import {
  getKnownModel,
  getKnownModelsForProvider,
  filterAndPaginateModels,
} from './known-models.js';

/**
 * AnthropicProvider — LLM provider for the Anthropic Messages API.
 *
 * Uses the @anthropic-ai/sdk package (optional peer dependency).
 * Translates canonical messages to Anthropic format via MessageTranslator.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private config: ProviderConfig;
  private clientPromise: Promise<any> | null = null;
  private modelCache: { data: ModelInfo[]; expiry: number } | null = null;
  private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Lazily initialize the Anthropic client (dynamic import).
   */
  private async getClient(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        let mod: any;
        try {
          mod = await import(
            /* webpackIgnore: true */ '@anthropic-ai/sdk' as string
          );
        } catch {
          throw new Error(
            'The @anthropic-ai/sdk package is required to use the Anthropic provider.\n' +
            'Install it with: npm install @anthropic-ai/sdk',
          );
        }
        const Anthropic = (mod.default ?? mod) as any;
        return new Anthropic({ apiKey: this.config.apiKey });
      })();
    }
    return this.clientPromise;
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const client = await this.getClient();

    // Translate to Anthropic format
    const anthropicMessages = toAnthropicMessages(messages);
    const tools = options.tools?.length
      ? toAnthropicTools(options.tools)
      : undefined;

    // Build request
    const request: Record<string, unknown> = {
      model: options.model || this.config.defaultModel || 'claude-sonnet-4-20250514',
      max_tokens: options.maxTokens ?? 8192,
      messages: anthropicMessages,
    };

    if (options.systemPrompt) {
      request.system = options.systemPrompt;
    }
    if (tools) {
      request.tools = tools;
    }
    if (options.temperature !== undefined) {
      request.temperature = options.temperature;
    }
    if (options.stopSequences?.length) {
      request.stop_sequences = options.stopSequences;
    }

    const response = await client.messages.create(request);

    // Parse response content blocks
    let content = '';
    const toolCalls: ChatResponse['toolCalls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }

    // Map Anthropic stop reasons to our canonical finish reasons
    const finishReason = mapAnthropicStopReason(response.stop_reason);

    return {
      content,
      toolCalls,
      finishReason,
      usage: response.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens:
              response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
    };
  }

  async listModels(options: ListModelsOptions = {}): Promise<ListModelsResult> {
    const allModels = await this.fetchModelsWithCache();
    return filterAndPaginateModels(allModels, options);
  }

  /**
   * Fetch models from the Anthropic API, enriched with known metadata.
   * Results are cached in memory with a 5-minute TTL.
   */
  private async fetchModelsWithCache(): Promise<ModelInfo[]> {
    if (this.modelCache && Date.now() < this.modelCache.expiry) {
      return this.modelCache.data;
    }

    let models: ModelInfo[];
    try {
      const client = await this.getClient();
      const apiModels: ModelInfo[] = [];

      // Paginate through all models
      let hasMore = true;
      let afterId: string | undefined;
      while (hasMore) {
        const params: Record<string, unknown> = { limit: 100 };
        if (afterId) params.after_id = afterId;
        const page = await client.models.list(params);

        for (const m of page.data ?? []) {
          const known = getKnownModel(m.id);
          apiModels.push({
            id: m.id,
            name: m.display_name ?? m.id,
            provider: 'anthropic',
            description: known?.description,
            contextLength: known?.contextLength,
            pricing: known?.pricing,
            created: m.created_at,
          });
        }

        hasMore = page.has_more ?? false;
        afterId = page.last_id;
      }

      models = apiModels;
    } catch {
      // If API call fails, fall back to known models only
      models = getKnownModelsForProvider('anthropic');
    }

    this.modelCache = { data: models, expiry: Date.now() + AnthropicProvider.CACHE_TTL_MS };
    return models;
  }
}

function mapAnthropicStopReason(
  reason: string | null | undefined,
): ChatResponse['finishReason'] {
  switch (reason) {
    case 'end_turn':
      return 'stop';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'unknown';
  }
}
