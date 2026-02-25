/**
 * Canonical message types used internally by Legion.
 * The internal format mirrors Anthropic's API structure (content block arrays)
 * to minimize translation for the primary provider.
 *
 * @typedef {Object} TextContent
 * @property {'text'} type
 * @property {string} text
 *
 * @typedef {Object} ToolUseContent
 * @property {'tool_use'} type
 * @property {string} id - Unique tool call ID
 * @property {string} name - Tool name
 * @property {Object} input - Tool arguments
 *
 * @typedef {Object} ToolResultContent
 * @property {'tool_result'} type
 * @property {string} toolUseId - Matches the tool_use id
 * @property {string|Object} content - Result value
 * @property {boolean} [isError] - Whether the tool execution failed
 *
 * @typedef {TextContent | ToolUseContent | ToolResultContent} MessageContent
 *
 * @typedef {Object} Message
 * @property {'user' | 'assistant'} role
 * @property {MessageContent[]} content
 *
 * @typedef {Object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {Object} inputSchema - JSON Schema for parameters
 *
 * @typedef {Object} CompletionRequest
 * @property {string} model
 * @property {string} [systemPrompt]
 * @property {Message[]} messages
 * @property {ToolDefinition[]} [tools]
 * @property {number} [maxTokens]
 * @property {number} [temperature]
 *
 * @typedef {Object} CompletionResponse
 * @property {'end_turn' | 'tool_use' | 'max_tokens'} stopReason
 * @property {MessageContent[]} content - Array of text and/or tool_use blocks
 * @property {Object} usage
 * @property {number} usage.inputTokens
 * @property {number} usage.outputTokens
 */

/**
 * Abstract LLM provider.
 * All providers normalize to the internal Message/Content types above.
 */
export class Provider {
  /**
   * Send a completion request and get a response.
   * @param {CompletionRequest} request
   * @returns {Promise<CompletionResponse>}
   */
  async createCompletion(request) {
    throw new Error('Provider.createCompletion() must be implemented');
  }

  /**
   * Get the provider name.
   * @returns {string}
   */
  get name() {
    throw new Error('Provider.name must be implemented');
  }
}
