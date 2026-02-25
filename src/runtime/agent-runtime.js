/**
 * The Agent Runtime drives an agent's execution loop:
 * 1. Assemble system prompt + conversation history + available tools
 * 2. Call the LLM provider
 * 3. If response contains tool_use: execute tools, append results, loop
 * 4. If response is end_turn: return final text response
 */
export class AgentRuntime {
  #providerRegistry;
  #toolExecutor;
  #toolRegistry;
  #activityLogger;

  /**
   * @param {Object} deps
   * @param {import('../providers/registry.js').ProviderRegistry} deps.providerRegistry
   * @param {import('./tool-executor.js').ToolExecutor} deps.toolExecutor
   * @param {import('../tools/tool-registry.js').ToolRegistry} deps.toolRegistry
   * @param {import('../repl/activity-logger.js').ActivityLogger} [deps.activityLogger]
   */
  constructor({ providerRegistry, toolExecutor, toolRegistry, activityLogger }) {
    this.#providerRegistry = providerRegistry;
    this.#toolExecutor = toolExecutor;
    this.#toolRegistry = toolRegistry;
    this.#activityLogger = activityLogger || null;
  }

  /**
   * Run an agent to produce a response in a conversation.
   * @param {Object} params
   * @param {import('../collective/agent.js').Agent} params.agent
   * @param {import('../communication/conversation.js').Conversation} params.conversation
   * @param {string} params.senderId - Who initiated this communication
   * @param {string} params.sessionId - Current session ID
   * @param {string[]} [params.communicationChain] - Chain of sender IDs from outermost to innermost
   * @param {import('../authorization/suspension-handler.js').SuspensionHandler} [params.suspensionHandler]
   * @returns {Promise<string>} The agent's final text response
   */
  async run({ agent, conversation, senderId, sessionId, communicationChain, suspensionHandler }) {
    const provider = this.#providerRegistry.get(agent.modelConfig.provider);
    const toolDefinitions = this.#toolRegistry.getDefinitions(agent.tools);

    // Get messages from conversation for this agent's perspective
    const messages = conversation.getMessagesForParticipant(agent.id);

    const { responseText } = await this.#toolLoop({
      agent,
      provider,
      messages,
      toolDefinitions,
      senderId,
      sessionId,
      conversation,
      communicationChain,
      suspensionHandler,
    });

    return responseText;
  }

  /**
   * Execute the inner tool-use loop.
   * @param {Object} params
   * @param {import('../collective/agent.js').Agent} params.agent
   * @param {import('../providers/provider.js').Provider} params.provider
   * @param {import('../providers/provider.js').Message[]} params.messages
   * @param {import('../providers/provider.js').ToolDefinition[]} params.toolDefinitions
   * @param {string} params.senderId
   * @param {string} params.sessionId
   * @param {import('../communication/conversation.js').Conversation} params.conversation
   * @param {string[]} [params.communicationChain]
   * @param {import('../authorization/suspension-handler.js').SuspensionHandler} [params.suspensionHandler]
   * @param {number} [maxIterations=20]
   * @returns {Promise<{responseText: string, finalContent: import('../providers/provider.js').MessageContent[]}>}
   */
  async #toolLoop({ agent, provider, messages, toolDefinitions, senderId, sessionId, conversation, communicationChain, suspensionHandler }, maxIterations = 20) {
    let currentMessages = [...messages];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      this.#activityLogger?.thinking(agent.name);

      const response = await provider.createCompletion({
        model: agent.modelConfig.model,
        systemPrompt: agent.systemPrompt,
        messages: currentMessages,
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        maxTokens: agent.modelConfig.maxTokens || 4096,
        temperature: agent.modelConfig.temperature,
      });

      // Check if the response contains tool use
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      if (response.stopReason !== 'tool_use' || toolUseBlocks.length === 0) {
        // End turn — extract final text
        const textBlocks = response.content.filter(b => b.type === 'text');
        const responseText = textBlocks.map(b => b.text).join('\n');
        return { responseText, finalContent: response.content };
      }

      // Append assistant message with tool_use to conversation
      conversation.addMessage(agent.id, 'assistant', response.content);
      currentMessages.push({ role: 'assistant', content: response.content });

      // Log and execute tool calls
      const toolCalls = toolUseBlocks.map(b => ({
        id: b.id,
        name: b.name,
        input: b.input,
      }));

      for (const tc of toolCalls) {
        this.#activityLogger?.toolCall(agent.name, tc.name, tc.input);
      }

      // Execute tools with safety wrapper — ensure every tool_use gets a tool_result
      // even if there's a catastrophic error
      let toolResults;
      try {
        toolResults = await this.#toolExecutor.executeAll(
          toolCalls,
          agent,
          {
            sessionId,
            senderId,
            callerId: agent.id,
            communicationChain: communicationChain || [],
            activeConversationId: conversation.id,
            suspensionHandler,
          }
        );
      } catch (err) {
        // Catastrophic error: generate error tool_results for ALL tool calls
        // to maintain message structure integrity (every tool_use must have
        // a corresponding tool_result)
        toolResults = toolCalls.map(tc => ({
          toolUseId: tc.id,
          content: `Internal error during tool execution: ${err.message}`,
          isError: true,
        }));
      }

      // Log tool results (errors only — successes are quiet)
      for (const r of toolResults) {
        if (r.isError) {
          this.#activityLogger?.toolResult(agent.name, toolCalls.find(tc => tc.id === r.toolUseId)?.name || 'unknown', true);
        }
      }

      // Build tool result content blocks
      /** @type {import('../providers/provider.js').MessageContent[]} */
      const resultContent = toolResults.map(r => ({
        type: 'tool_result',
        toolUseId: r.toolUseId,
        content: r.content,
        ...(r.isError ? { isError: true } : {}),
      }));

      // Append tool results as a user message
      conversation.addMessage(senderId, 'user', resultContent);
      currentMessages.push({ role: 'user', content: resultContent });
    }

    // Safety: max iterations reached
    return {
      responseText: '[Agent reached maximum tool call iterations]',
      finalContent: [{ type: 'text', text: '[Agent reached maximum tool call iterations]' }],
    };
  }
}
