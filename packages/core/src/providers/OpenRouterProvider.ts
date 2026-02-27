import { OpenAIProvider } from './OpenAIProvider.js';
import type {
  ChatOptions,
  ChatResponse,
  ProviderConfig,
  LLMProvider,
} from './Provider.js';
import type { Message } from '../communication/Message.js';

/**
 * OpenRouterProvider — LLM provider using OpenRouter's API.
 *
 * OpenRouter is OpenAI-compatible, so this wraps OpenAIProvider
 * with the appropriate base URL. OpenRouter supports models from
 * multiple providers (Anthropic, OpenAI, Google, etc.) through
 * a unified API.
 */
export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';
  private delegate: OpenAIProvider;

  constructor(config: ProviderConfig) {
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
}
