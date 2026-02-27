import type { LLMProvider, ProviderConfig } from './Provider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';

/**
 * ProviderFactory — creates the correct LLMProvider from a ProviderConfig.
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    default:
      throw new Error(
        `Unknown provider: ${(config as ProviderConfig).provider}`,
      );
  }
}
