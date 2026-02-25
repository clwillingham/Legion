import OpenAI from 'openai';
import { Provider } from './provider.js';

/**
 * OpenAI provider adapter.
 * Structural transformation required — OpenAI's Chat Completions API differs
 * significantly from the internal (Anthropic-like) format.
 * @extends Provider
 */
export class OpenAIProvider extends Provider {
  #client;

  /**
   * @param {Object} [config]
   * @param {string} [config.apiKey] - Defaults to OPENAI_API_KEY env var
   */
  constructor(config = {}) {
    super();
    this.#client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
    });
  }

  /** @override */
  get name() { return 'openai'; }

  /** @override */
  async createCompletion(request) {
    const params = {
      model: request.model,
      messages: this.#convertMessagesToAPI(request.messages, request.systemPrompt),
    };

    if (request.maxTokens) {
      params.max_tokens = request.maxTokens;
    }

    if (request.tools && request.tools.length > 0) {
      params.tools = this.#convertToolsToAPI(request.tools);
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    const response = await this.#client.chat.completions.create(params);
    return this.#convertResponseFromAPI(response);
  }

  /**
   * Convert internal tool definitions to OpenAI format.
   * Internal: { name, description, inputSchema }
   * OpenAI:   { type: "function", function: { name, description, parameters } }
   * @param {import('./provider.js').ToolDefinition[]} tools
   * @returns {Object[]}
   */
  #convertToolsToAPI(tools) {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Convert internal messages to OpenAI format.
   *
   * Key differences:
   * - System prompt becomes first message with role "system"
   * - Assistant messages with ToolUseContent become tool_calls on the message
   * - User messages with ToolResultContent become separate role "tool" messages
   * - Text content is a string, not an array of blocks
   *
   * @param {import('./provider.js').Message[]} messages
   * @param {string} [systemPrompt]
   * @returns {Object[]}
   */
  #convertMessagesToAPI(messages, systemPrompt) {
    /** @type {Object[]} */
    const result = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'assistant') {
        result.push(this.#convertAssistantMessage(msg));
      } else {
        // User message — may contain text and/or tool_result blocks
        const toolResults = msg.content.filter(b => b.type === 'tool_result');
        const textBlocks = msg.content.filter(b => b.type === 'text');

        // Tool results become separate role:"tool" messages
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.toolUseId,
            content: typeof tr.content === 'string'
              ? tr.content
              : JSON.stringify(tr.content),
          });
        }

        // Text blocks become a regular user message
        if (textBlocks.length > 0) {
          result.push({
            role: 'user',
            content: textBlocks.map(b => b.text).join('\n'),
          });
        }
      }
    }

    return result;
  }

  /**
   * Convert an internal assistant message to OpenAI format.
   * @param {import('./provider.js').Message} msg
   * @returns {Object}
   */
  #convertAssistantMessage(msg) {
    const textBlocks = msg.content.filter(b => b.type === 'text');
    const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use');

    const result = { role: 'assistant' };

    if (textBlocks.length > 0) {
      result.content = textBlocks.map(b => b.text).join('\n');
    } else {
      result.content = null;
    }

    if (toolUseBlocks.length > 0) {
      result.tool_calls = toolUseBlocks.map(block => ({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      }));
    }

    return result;
  }

  /**
   * Convert OpenAI response to internal format.
   * @param {Object} response
   * @returns {import('./provider.js').CompletionResponse}
   */
  #convertResponseFromAPI(response) {
    const choice = response.choices[0];
    const message = choice.message;

    /** @type {import('./provider.js').MessageContent[]} */
    const content = [];

    if (message.content) {
      content.push({ type: 'text', text: message.content });
    }

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
    }

    // Map OpenAI finish_reason to internal stopReason
    let stopReason;
    switch (choice.finish_reason) {
      case 'stop': stopReason = 'end_turn'; break;
      case 'tool_calls': stopReason = 'tool_use'; break;
      case 'length': stopReason = 'max_tokens'; break;
      default: stopReason = choice.finish_reason;
    }

    return {
      stopReason,
      content,
      usage: {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      },
    };
  }
}
