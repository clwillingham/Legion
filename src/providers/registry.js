import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

/**
 * Registry of available LLM providers.
 */
export class ProviderRegistry {
  /** @type {Map<string, import('./provider.js').Provider>} */
  #providers = new Map();

  /**
   * Register a provider instance by name.
   * @param {string} name
   * @param {import('./provider.js').Provider} provider
   */
  register(name, provider) {
    this.#providers.set(name, provider);
  }

  /**
   * Get a provider by name.
   * @param {string} name - "anthropic" or "openai"
   * @returns {import('./provider.js').Provider}
   * @throws {Error} If provider not registered
   */
  get(name) {
    const provider = this.#providers.get(name);
    if (!provider) {
      throw new Error(
        `Provider "${name}" not registered. Available: ${[...this.#providers.keys()].join(', ')}`
      );
    }
    return provider;
  }

  /**
   * Create a default registry with Anthropic and OpenAI providers.
   * Only registers providers whose API keys are available.
   * @returns {ProviderRegistry}
   */
  static createDefault() {
    const registry = new ProviderRegistry();

    if (process.env.ANTHROPIC_API_KEY) {
      registry.register('anthropic', new AnthropicProvider());
    }

    if (process.env.OPENAI_API_KEY) {
      registry.register('openai', new OpenAIProvider());
    }

    return registry;
  }

  /**
   * List registered provider names.
   * @returns {string[]}
   */
  listProviders() {
    return [...this.#providers.keys()];
  }
}
