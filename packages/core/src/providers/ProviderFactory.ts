import type { LLMProvider, ProviderConfig } from './Provider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';

/**
 * ProviderFactory — creates the correct LLMProvider from a ProviderConfig.
 *
 * Resolution order for adapter type:
 *   config.type → config.provider → throw
 *
 * For 'openai-compatible', an OpenAIProvider is created with the custom
 * baseUrl and the provider's name (populated by the caller).
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  // `type` is the authoritative adapter discriminator; fall back to `provider`
  // for backward compatibility with old config objects that only had `provider`.
  const adapterType = config.type ?? config.provider;

  switch (adapterType) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'openai-compatible':
      // Reuse OpenAIProvider with the custom baseUrl.
      // `config.name` is the user-chosen provider record key (e.g. 'llamacpp').
      return new OpenAIProvider(config, config.name);
    default:
      throw new Error(
        `Unknown provider adapter type "${adapterType}" for provider "${config.name ?? config.provider}". ` +
        `Valid adapter types: anthropic, openai, openrouter, openai-compatible.`,
      );
  }
}
