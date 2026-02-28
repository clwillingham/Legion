import { OpenAIProvider } from './OpenAIProvider.js';
import type {
  ChatOptions,
  ChatResponse,
  ProviderConfig,
  LLMProvider,
  ListModelsOptions,
  ListModelsResult,
  ModelInfo,
} from './Provider.js';
import type { Message } from '../communication/Message.js';
import { filterAndPaginateModels } from './known-models.js';

/**
 * OpenRouterProvider — LLM provider using OpenRouter's API.
 *
 * OpenRouter is OpenAI-compatible, so this wraps OpenAIProvider
 * with the appropriate base URL. OpenRouter supports models from
 * multiple providers (Anthropic, OpenAI, Google, etc.) through
 * a unified API.
 *
 * Model listing uses OpenRouter's rich models endpoint which
 * includes pricing, context length, and architecture information.
 */
export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';
  private delegate: OpenAIProvider;
  private config: ProviderConfig;
  private modelCache: { data: ModelInfo[]; expiry: number } | null = null;
  private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: ProviderConfig) {
    this.config = config;
    this.delegate = new OpenAIProvider(
      {
        ...config,
        baseUrl: config.baseUrl ?? 'https://openrouter.ai/api/v1',
      },
      'openrouter',
    );
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    return this.delegate.chat(messages, options);
  }

  async listModels(options: ListModelsOptions = {}): Promise<ListModelsResult> {
    const allModels = await this.fetchModelsWithCache(options.category);
    return filterAndPaginateModels(allModels, options);
  }

  /**
   * Fetch models from the OpenRouter models API.
   * The API returns full metadata including pricing, so no
   * known-models enrichment is needed.
   */
  private async fetchModelsWithCache(category?: string): Promise<ModelInfo[]> {
    // Invalidate cache if category changes (rare edge case)
    if (this.modelCache && Date.now() < this.modelCache.expiry && !category) {
      return this.modelCache.data;
    }

    const baseUrl = this.config.baseUrl ?? 'https://openrouter.ai/api/v1';
    const url = new URL(`${baseUrl}/models`);
    if (category) url.searchParams.set('category', category);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`OpenRouter models API returned ${response.status}: ${response.statusText}`);
    }

    const body = (await response.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        description?: string;
        context_length?: number;
        created?: number;
        pricing?: {
          prompt?: string;
          completion?: string;
          input_cache_read?: string;
          input_cache_write?: string;
        };
        architecture?: {
          input_modalities?: string[];
          output_modalities?: string[];
        };
        supported_parameters?: string[];
      }>;
    };

    const models: ModelInfo[] = (body.data ?? []).map((m) => {
      // OpenRouter pricing is per-token as a string; convert to per-MTok
      const promptPerToken = parseFloat(m.pricing?.prompt ?? '0');
      const completionPerToken = parseFloat(m.pricing?.completion ?? '0');
      const cacheReadPerToken = parseFloat(m.pricing?.input_cache_read ?? '0');
      const cacheWritePerToken = parseFloat(m.pricing?.input_cache_write ?? '0');

      return {
        id: m.id,
        name: m.name ?? m.id,
        provider: 'openrouter',
        description: m.description,
        contextLength: m.context_length,
        pricing: {
          promptPerMTok: promptPerToken * 1_000_000,
          completionPerMTok: completionPerToken * 1_000_000,
          ...(cacheReadPerToken > 0 ? { cacheReadPerMTok: cacheReadPerToken * 1_000_000 } : {}),
          ...(cacheWritePerToken > 0 ? { cacheWritePerMTok: cacheWritePerToken * 1_000_000 } : {}),
        },
        created: m.created
          ? new Date(m.created * 1000).toISOString()
          : undefined,
        modalities: m.architecture
          ? {
              input: m.architecture.input_modalities ?? ['text'],
              output: m.architecture.output_modalities ?? ['text'],
            }
          : undefined,
        supportedParameters: m.supported_parameters,
      };
    });

    // Only cache non-category-filtered results (the full list)
    if (!category) {
      this.modelCache = { data: models, expiry: Date.now() + OpenRouterProvider.CACHE_TTL_MS };
    }

    return models;
  }
}
