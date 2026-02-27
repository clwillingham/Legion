import { ParticipantRuntime, RuntimeContext, RuntimeResult } from './ParticipantRuntime.js';
import { RuntimeConfig } from './RuntimeConfig.js';
import { ToolExecutor } from './ToolExecutor.js';
import type { AgentConfig } from '../collective/Participant.js';
import type { Tool, ToolCallResult } from '../tools/Tool.js';
import type { ToolDefinition, LLMProvider } from '../providers/Provider.js';
import { createProvider } from '../providers/ProviderFactory.js';
import { createMessage, type Message } from '../communication/Message.js';

/**
 * AgentRuntime — the agentic loop for AI participants.
 *
 * Implements handleMessage() by:
 * 1. Resolving available tools from the ToolRegistry based on the agent's tool policy
 * 2. Creating an LLM provider from the agent's model config
 * 3. Running the loop: LLM call → tool execution → feed results → repeat
 * 4. Returning when the LLM produces a text response (no tool calls)
 *
 * The loop is bounded by maxIterations to prevent runaway execution.
 */
export class AgentRuntime extends ParticipantRuntime {
  async handleMessage(_message: string, context: RuntimeContext): Promise<RuntimeResult> {
    const agentConfig = context.participant as AgentConfig;
    const runtimeConfig = RuntimeConfig.resolve(context.config, agentConfig.runtimeConfig);

    // Resolve tools this agent has access to based on its tool policy
    const tools = this.resolveTools(context);
    const toolDefinitions = this.toToolDefinitions(tools);

    // Create the LLM provider
    let provider: LLMProvider;
    try {
      provider = this.createProvider(agentConfig, context);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: `Failed to create LLM provider for agent "${agentConfig.name}": ${errorMessage}`,
      };
    }

    // Build the message history from the conversation
    // The conversation already has the user message appended by Conversation.send(),
    // so we use the full conversation history.
    const conversationMessages = context.conversation.getMessages();

    // We'll maintain a working copy of messages that includes tool results
    // from within this agentic loop iteration (not yet persisted to conversation).
    const workingMessages: Message[] = [...conversationMessages];

    let iterations = 0;

    while (iterations < runtimeConfig.maxIterations) {
      iterations++;

      // Emit iteration event
      context.eventBus.emit({
        type: 'iteration',
        sessionId: context.session.data.id,
        participantId: agentConfig.id,
        iteration: iterations,
        maxIterations: runtimeConfig.maxIterations,
        timestamp: new Date(),
      });

      try {
        // Call the LLM
        const response = await provider.chat(workingMessages, {
          model: agentConfig.model.model,
          systemPrompt: agentConfig.systemPrompt,
          tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
          temperature: agentConfig.model.temperature,
          maxTokens: agentConfig.model.maxTokens,
        });

        // No tool calls — the agent is done, return the text response
        if (response.toolCalls.length === 0) {
          return {
            status: 'success',
            response: response.content || '(no response)',
          };
        }

        // The response has tool calls — execute them and feed results back

        // First, append the assistant message with tool calls to working history
        const assistantMessage = createMessage(
          'assistant',
          agentConfig.id,
          response.content,
          response.toolCalls.map((tc) => ({
            id: tc.id,
            tool: tc.name,
            args: tc.arguments,
          })),
        );
        workingMessages.push(assistantMessage);

        // Execute each tool call
        const toolExecutor = new ToolExecutor(context, context.authEngine);
        const toolResults: ToolCallResult[] = [];

        for (const toolCall of response.toolCalls) {
          // Emit tool call event
          context.eventBus.emit({
            type: 'tool:call',
            sessionId: context.session.data.id,
            participantId: agentConfig.id,
            toolName: toolCall.name,
            arguments: toolCall.arguments,
            timestamp: new Date(),
          });

          const result = await toolExecutor.execute(
            { id: toolCall.id, tool: toolCall.name, args: toolCall.arguments },
            agentConfig,
          );

          // Handle approval_required — pause the loop and bubble up
          if (result.status === 'approval_required') {
            return {
              status: 'approval_required',
              response: response.content || undefined,
              approvalRequest: result.approvalRequest,
            };
          }

          // Convert to ToolCallResult for the message history
          const resultContent = result.status === 'success'
            ? (typeof result.data === 'string' ? result.data : JSON.stringify(result.data))
            : `Error: ${result.error}`;

          const toolCallResult: ToolCallResult = {
            toolCallId: toolCall.id,
            tool: toolCall.name,
            status: result.status === 'success' ? 'success' : 'error',
            result: resultContent,
          };

          toolResults.push(toolCallResult);

          // Emit tool result event
          context.eventBus.emit({
            type: 'tool:result',
            sessionId: context.session.data.id,
            participantId: agentConfig.id,
            toolName: toolCall.name,
            result: {
              success: result.status === 'success',
              output: resultContent,
            },
            timestamp: new Date(),
          });
        }

        // Append a user message with tool results to working history
        // (tool results are fed back as the "user" role for the next LLM turn)
        const toolResultMessage = createMessage(
          'user',
          agentConfig.id,
          '',
          undefined,
          toolResults,
        );
        workingMessages.push(toolResultMessage);

        // Continue the loop — the LLM will see the tool results and decide
        // whether to make more tool calls or produce a final response.
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        context.eventBus.emit({
          type: 'error',
          sessionId: context.session.data.id,
          participantId: agentConfig.id,
          error: error instanceof Error ? error : new Error(errorMessage),
          timestamp: new Date(),
        });

        return {
          status: 'error',
          error: `Agent "${agentConfig.name}" encountered an error: ${errorMessage}`,
        };
      }
    }

    // Iteration limit reached
    return {
      status: 'error',
      error:
        `Agent "${agentConfig.name}" reached the maximum iteration limit ` +
        `(${runtimeConfig.maxIterations}). The agent may be stuck in a loop.`,
    };
  }

  /**
   * Resolve the tools this agent has access to based on its tool policy config.
   */
  private resolveTools(context: RuntimeContext): Tool[] {
    return context.toolRegistry.resolveForParticipant(context.participant.tools);
  }

  /**
   * Convert Tool[] to ToolDefinition[] for the LLM provider.
   */
  private toToolDefinitions(tools: Tool[]): ToolDefinition[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * Create an LLM provider from the agent's model config and resolved API key.
   */
  private createProvider(agentConfig: AgentConfig, context: RuntimeContext): LLMProvider {
    const apiKey = context.config.resolveApiKey(agentConfig.model.provider);

    if (!apiKey) {
      throw new Error(
        `No API key found for provider "${agentConfig.model.provider}". ` +
        `Set it via 'legion config set-provider' or the appropriate environment variable.`,
      );
    }

    return createProvider({
      provider: agentConfig.model.provider,
      apiKey,
      baseUrl: undefined,
      defaultModel: agentConfig.model.model,
    });
  }
}
