import OpenAI from 'openai';
import { Provider } from './provider.js';

/**
 * @typedef {Object} OpenAIMessage
 * @property {string} role
 * @property {string|null} [content]
 * @property {string} [tool_call_id]
 * @property {Array<{id: string, type: string, function: {name: string, arguments: string}}>} [tool_calls]
 */

/**
 * @typedef {Object} OpenAIToolDef
 * @property {'function'} type
 * @property {{name: string, description: string, parameters: Object}} function
 */

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

  /**
   * @override
   * @param {import('./provider.js').CompletionRequest} request
   * @returns {Promise<import('./provider.js').CompletionResponse>}
   */
  async createCompletion(request) {
    /** @type {OpenAI.ChatCompletionCreateParams} */
    const params = {
      model: request.model,
      messages: /** @type {OpenAI.ChatCompletionMessageParam[]} */ (
        this.#convertMessagesToAPI(request.messages, request.systemPrompt)
      ),
    };

    if (request.maxTokens) {
      params.max_tokens = request.maxTokens;
    }

    if (request.tools && request.tools.length > 0) {
      params.tools = /** @type {OpenAI.ChatCompletionTool[]} */ (
        this.#convertToolsToAPI(request.tools)
      );
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
   * @returns {OpenAIToolDef[]}
   */
  #convertToolsToAPI(tools) {
    return tools.map(tool => ({
      type: /** @type {const} */ ('function'),
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
   * @returns {OpenAIMessage[]}
   */
  #convertMessagesToAPI(messages, systemPrompt) {
    /** @type {OpenAIMessage[]} */
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
          const toolResult = /** @type {import('./provider.js').ToolResultContent} */ (tr);
          result.push({
            role: 'tool',
            tool_call_id: toolResult.toolUseId,
            content: typeof toolResult.content === 'string'
              ? toolResult.content
              : JSON.stringify(toolResult.content),
          });
        }

        // Text blocks become a regular user message
        if (textBlocks.length > 0) {
          result.push({
            role: 'user',
            content: textBlocks.map(b => /** @type {import('./provider.js').TextContent} */ (b).text).join('\n'),
          });
        }
      }
    }

    return result;
  }

  /**
   * Convert an internal assistant message to OpenAI format.
   * @param {import('./provider.js').Message} msg
   * @returns {OpenAIMessage}
   */
  #convertAssistantMessage(msg) {
    const textBlocks = msg.content.filter(b => b.type === 'text');
    const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use');

    /** @type {OpenAIMessage} */
    const result = { role: 'assistant' };

    if (textBlocks.length > 0) {
      result.content = textBlocks.map(b => /** @type {import('./provider.js').TextContent} */ (b).text).join('\n');
    } else {
      result.content = null;
    }

    if (toolUseBlocks.length > 0) {
      result.tool_calls = toolUseBlocks.map(block => {
        const toolUse = /** @type {import('./provider.js').ToolUseContent} */ (block);
        return {
          id: toolUse.id,
          type: 'function',
          function: {
            name: toolUse.name,
            arguments: JSON.stringify(toolUse.input),
          },
        };
      });
    }

    return result;
  }

  /**
   * Convert OpenAI response to internal format.
   * @param {OpenAI.ChatCompletion} response
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
    /** @type {import('./provider.js').CompletionResponse['stopReason']} */
    let stopReason;
    switch (choice.finish_reason) {
      case 'stop': stopReason = 'end_turn'; break;
      case 'tool_calls': stopReason = 'tool_use'; break;
      case 'length': stopReason = 'max_tokens'; break;
      default: stopReason = /** @type {import('./provider.js').CompletionResponse['stopReason']} */ (choice.finish_reason);
    }

    return {
      stopReason,
      content,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
