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

const GITHUB_MODELS_INFERENCE_BASE = 'https://models.github.ai/inference';
const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';
const GITHUB_API_VERSION = '2022-11-28';

/**
 * GitHubModelsProvider — LLM provider for the GitHub Models API.
 *
 * GitHub Models exposes an OpenAI-compatible chat inference endpoint at
 * https://models.github.ai/inference and a catalog endpoint for listing
 * available models. Authentication uses a GitHub Personal Access Token
 * (PAT) with `models:read` scope.
 *
 * Model IDs use the {publisher}/{model_name} format, e.g. "openai/gpt-4.1".
 *
 * Rate limits vary by Copilot subscription tier (Free / Pro / Business /
 * Enterprise). See https://docs.github.com/en/github-models for details.
 */
export class GitHubModelsProvider implements LLMProvider {
  readonly name = 'github-models';
  private delegate: OpenAIProvider;
  private config: ProviderConfig;
  private modelCache: { data: ModelInfo[]; expiry: number } | null = null;
  private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: ProviderConfig) {
    this.config = config;
    this.delegate = new OpenAIProvider(
      {
        ...config,
        baseUrl: config.baseUrl ?? GITHUB_MODELS_INFERENCE_BASE,
      },
      'github-models',
    );
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    return this.delegate.chat(messages, options);
  }

  async listModels(options: ListModelsOptions = {}): Promise<ListModelsResult> {
    const allModels = await this.fetchModelsWithCache();
    return filterAndPaginateModels(allModels, options);
  }

  private async fetchModelsWithCache(): Promise<ModelInfo[]> {
    if (this.modelCache && Date.now() < this.modelCache.expiry) {
      return this.modelCache.data;
    }

    let models: ModelInfo[];
    try {
      models = await this.fetchCatalog();
    } catch (err) {
      // Fall back to configured static model list when available.
      // If no static list is configured, rethrow so the caller (e.g. list_models
      // tool) can surface the error rather than silently returning nothing.
      const staticModels = this.config.models ?? [];
      if (staticModels.length > 0) {
        models = staticModels.map((m) =>
          typeof m === 'string'
            ? { id: m, name: m, provider: this.name }
            : {
                id: m.id,
                name: m.name ?? m.id,
                provider: this.name,
                description: m.description,
                contextLength: m.contextLength,
              },
        );
      } else {
        throw err;
      }
    }

    this.modelCache = { data: models, expiry: Date.now() + GitHubModelsProvider.CACHE_TTL_MS };
    return models;
  }

  private async fetchCatalog(): Promise<ModelInfo[]> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(GITHUB_MODELS_CATALOG_URL, { headers });
    if (!response.ok) {
      throw new Error(
        `GitHub Models catalog returned ${response.status}: ${response.statusText}`,
      );
    }

    const catalog = (await response.json()) as Array<{
      id: string;
      name?: string;
      publisher?: string;
      summary?: string;
      capabilities?: string[];
      limits?: {
        max_input_tokens?: number;
        max_output_tokens?: number;
      };
      rate_limit_tier?: string;
      supported_input_modalities?: string[];
      supported_output_modalities?: string[];
      tags?: string[];
    }>;

    return catalog.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      provider: this.name,
      description: m.summary,
      contextLength: m.limits?.max_input_tokens,
      modalities:
        m.supported_input_modalities || m.supported_output_modalities
          ? {
              input: m.supported_input_modalities ?? ['text'],
              output: m.supported_output_modalities ?? ['text'],
            }
          : undefined,
      supportedParameters: m.capabilities,
    }));
  }
}
