import type {
  LLMProvider,
  ChatOptions,
  ChatResponse,
  ProviderConfig,
} from './Provider.js';
import type { Message } from '../communication/Message.js';
import { toAnthropicMessages, toAnthropicTools } from './MessageTranslator.js';

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
