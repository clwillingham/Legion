import Anthropic from '@anthropic-ai/sdk';
import { Provider } from './provider.js';

/**
 * @typedef {Object} AnthropicToolDef
 * @property {string} name
 * @property {string} description
 * @property {Object} input_schema
 */

/**
 * @typedef {Object} AnthropicMessage
 * @property {'user' | 'assistant'} role
 * @property {Array<Record<string, unknown>>} content
 */

/**
 * Anthropic Claude provider adapter.
 * Translation is near-identity since the internal format mirrors Anthropic's API.
 * Mostly camelCase→snake_case conversions.
 * @extends Provider
 */
export class AnthropicProvider extends Provider {
  #client;

  /**
   * @param {Object} [config]
   * @param {string} [config.apiKey] - Defaults to ANTHROPIC_API_KEY env var
   */
  constructor(config = {}) {
    super();
    this.#client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  /** @override */
  get name() { return 'anthropic'; }

  /**
   * @override
   * @param {import('./provider.js').CompletionRequest} request
   * @returns {Promise<import('./provider.js').CompletionResponse>}
   */
  async createCompletion(request) {
    /** @type {Anthropic.MessageCreateParams} */
    const params = {
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      messages: /** @type {Anthropic.MessageParam[]} */ (/** @type {unknown} */ (
        this.#convertMessagesToAPI(request.messages)
      )),
    };

    if (request.systemPrompt) {
      params.system = request.systemPrompt;
    }

    if (request.tools && request.tools.length > 0) {
      params.tools = /** @type {Anthropic.Tool[]} */ (
        this.#convertToolsToAPI(request.tools)
      );
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    const response = await this.#client.messages.create(params);
    return this.#convertResponseFromAPI(response);
  }

  /**
   * Convert internal tool definitions to Anthropic format.
   * @param {import('./provider.js').ToolDefinition[]} tools
   * @returns {AnthropicToolDef[]}
   */
  #convertToolsToAPI(tools) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  /**
   * Convert internal messages to Anthropic format.
   * @param {import('./provider.js').Message[]} messages
   * @returns {AnthropicMessage[]}
   */
  #convertMessagesToAPI(messages) {
    /** @type {AnthropicMessage[]} */
    const converted = messages.map(msg => ({
      role: msg.role,
      content: msg.content.map(block => {
        if (block.type === 'tool_result') {
          return {
            type: /** @type {const} */ ('tool_result'),
            tool_use_id: /** @type {import('./provider.js').ToolResultContent} */ (block).toolUseId,
            content: typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content),
            ...(/** @type {import('./provider.js').ToolResultContent} */ (block).isError ? { is_error: true } : {}),
          };
        }
        // text and tool_use blocks are structurally identical
        return /** @type {Record<string, unknown>} */ (block);
      }),
    }));

    return this.#validateAndFixMessageOrder(converted);
  }

  /**
   * Defensive validation: ensure every assistant message with tool_use blocks
   * is immediately followed by a user message containing matching tool_result
   * blocks. If a non-tool-result message appears between them, reorder to
   * consolidate tool_results immediately after their tool_use.
   *
   * This is a safety net for edge cases where conversation mutations
   * (e.g., self-conversation via communicator) might disrupt ordering.
   *
   * @param {AnthropicMessage[]} messages
   * @returns {AnthropicMessage[]}
   */
  #validateAndFixMessageOrder(messages) {
    /** @type {AnthropicMessage[]} */
    const fixed = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Only process assistant messages with tool_use blocks
      if (msg.role !== 'assistant') {
        fixed.push(msg);
        continue;
      }

      const toolUseIds = new Set(
        (msg.content || [])
          .filter(b => b.type === 'tool_use')
          .map(b => /** @type {string} */ (b.id))
      );

      if (toolUseIds.size === 0) {
        fixed.push(msg);
        continue;
      }

      // Push the assistant message
      fixed.push(msg);

      // Look ahead for matching tool_result blocks
      // They should be in the immediately next message, but may be
      // separated by spurious messages due to conversation mutations
      /** @type {Array<Record<string, unknown>>} */
      const toolResultBlocks = [];
      /** @type {AnthropicMessage[]} */
      const deferredMessages = [];
      let j = i + 1;

      while (j < messages.length) {
        const nextMsg = messages[j];
        const matchingResults = (nextMsg.content || []).filter(
          b => b.type === 'tool_result' && toolUseIds.has(/** @type {string} */ (b.tool_use_id))
        );
        const otherContent = (nextMsg.content || []).filter(
          b => !(b.type === 'tool_result' && toolUseIds.has(/** @type {string} */ (b.tool_use_id)))
        );

        if (matchingResults.length > 0) {
          toolResultBlocks.push(...matchingResults);
          // Keep non-matching content as a deferred message
          if (otherContent.length > 0) {
            deferredMessages.push({ role: nextMsg.role, content: otherContent });
          }
          j++;
          // Check if we found all results
          if (toolResultBlocks.length >= toolUseIds.size) break;
        } else {
          // This message has no matching tool_results — defer it
          deferredMessages.push(nextMsg);
          j++;
        }
      }

      // Add the consolidated tool_result message right after the assistant message
      if (toolResultBlocks.length > 0) {
        fixed.push({ role: 'user', content: toolResultBlocks });
      }

      // Add back any deferred messages
      for (const dm of deferredMessages) {
        fixed.push(dm);
      }

      // Skip the messages we already processed
      i = j - 1;
    }

    return fixed;
  }

  /**
   * Convert Anthropic response to internal format.
   * @param {Anthropic.Message} response
   * @returns {import('./provider.js').CompletionResponse}
   */
  #convertResponseFromAPI(response) {
    return {
      stopReason: /** @type {import('./provider.js').CompletionResponse['stopReason']} */ (response.stop_reason),
      content: response.content.map(block => /** @type {import('./provider.js').MessageContent} */ (block)),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
