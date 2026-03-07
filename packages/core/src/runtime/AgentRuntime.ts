import { ParticipantRuntime, RuntimeContext, RuntimeResult } from './ParticipantRuntime.js';
import { RuntimeConfig, type ResolvedRuntimeConfig } from './RuntimeConfig.js';
import { ToolExecutor } from './ToolExecutor.js';
import type { AgentConfig } from '../collective/Participant.js';
import type { Tool, ToolCallResult } from '../tools/Tool.js';
import type { ToolDefinition, LLMProvider } from '../providers/Provider.js';
import { createProvider } from '../providers/ProviderFactory.js';
import { createMessage } from '../communication/Message.js';
import { hasAuthority } from '../authorization/authority.js';
import type { PendingApprovalRequest } from '../authorization/PendingApprovalRegistry.js';

/**
 * AgentRuntime — the agentic loop for AI participants.
 *
 * Implements handleMessage() by:
 * 1. Resolving available tools from the ToolRegistry based on the agent's tool policy
 * 2. Creating an LLM provider from the agent's model config
 * 3. Running a loop: LLM call → tool execution → feed results → repeat
 * 4. Returning when the LLM produces a text response (no tool calls)
 *
 * The loop is bounded by maxIterations to prevent runaway execution.
 *
 * All intermediate messages (assistant messages with tool calls, tool result
 * messages, and the final text response) are appended to the Conversation via
 * appendMessage(), which persists them to disk. This means the full message
 * history is always available for crash recovery or inspection.
 *
 * Approval Authority Delegation (Phase 3.3):
 * When a tool call requires approval and the calling participant has authority
 * (per their `approvalAuthority` config), the tool call is held as "pending"
 * instead of immediately invoking the ApprovalHandler. All pending calls from
 * a single iteration are batched into one `approval_required` result. The calling
 * participant then resolves them via the `approval_response` tool, which invokes
 * the stored `resume()` continuation to execute the held tools and continue the loop.
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

    // The conversation already has the user message appended by Conversation.send(),
    // so we start the loop directly — it reads messages from the conversation.
    return this.runLoop(0, context, agentConfig, runtimeConfig, provider, toolDefinitions);
  }

  /**
   * Run the agentic loop from a given starting state.
   *
   * Extracted so that the `resume` continuation stored in PendingApprovalRegistry
   * can re-enter the loop after pending approvals are resolved.
   *
   * All intermediate messages are appended to the conversation via appendMessage(),
   * which persists them to disk. The LLM reads messages from the conversation
   * at each iteration.
   *
   * @param startedIterations   Number of iterations already consumed before this call
   */
  async runLoop(
    startedIterations: number,
    context: RuntimeContext,
    agentConfig: AgentConfig,
    runtimeConfig: ResolvedRuntimeConfig,
    provider: LLMProvider,
    toolDefinitions: ToolDefinition[],
  ): Promise<RuntimeResult> {
    const toolExecutor = new ToolExecutor(context, context.authEngine);
    let iterations = startedIterations;

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
        // Call the LLM — read current messages from the conversation
        const response = await provider.chat([...context.conversation.getMessages()], {
          model: agentConfig.model.model,
          systemPrompt: agentConfig.systemPrompt,
          tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
          temperature: agentConfig.model.temperature,
          maxTokens: agentConfig.model.maxTokens,
        });

        // No tool calls — the agent is done, return the text response
        if (response.toolCalls.length === 0) {
          // Persist the final response to the conversation
          await context.conversation.appendMessage(
            createMessage('assistant', agentConfig.id, response.content || '(no response)'),
          );
          return {
            status: 'success',
            response: response.content || '(no response)',
            messagesPersisted: true,
          };
        }

        // The response has tool calls — execute them and feed results back.
        // First, append the assistant message with tool calls to the conversation (persists to disk).
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
        await context.conversation.appendMessage(assistantMessage);

        // ── Categorise tool calls ─────────────────────────────────────────────
        // Map from toolCallId → result (filled as we go, preserving LLM order)
        const resultMap = new Map<string, ToolCallResult>();

        // Tool calls that need caller approval (held for this iteration)
        const heldCalls: Array<{
          toolCallId: string;
          toolName: string;
          toolArguments: Record<string, unknown>;
          requestId: string;
        }> = [];

        // Determine the calling participant's config once for this iteration
        const callerConfig = context.callingParticipantId
          ? context.session.collective.get(context.callingParticipantId)
          : undefined;

        for (const toolCall of response.toolCalls) {
          const toolArgs = toolCall.arguments as Record<string, unknown>;

          // Check if this tool should be held for caller approval
          if (callerConfig) {
            const effectivePolicy = context.authEngine.getEffectivePolicy(
              toolCall.name,
              toolArgs,
              agentConfig.tools,
            );

            if (
              effectivePolicy === 'requires_approval' &&
              hasAuthority(callerConfig.approvalAuthority, agentConfig.id, toolCall.name, toolArgs)
            ) {
              // Hold this tool call — the caller will decide
              heldCalls.push({
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                toolArguments: toolArgs,
                requestId: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              });

              context.eventBus.emit({
                type: 'tool:call',
                sessionId: context.session.data.id,
                participantId: agentConfig.id,
                toolName: toolCall.name,
                arguments: toolArgs,
                timestamp: new Date(),
              });

              continue; // Skip immediate execution
            }
          }

          // ── Execute tool immediately ─────────────────────────────────────
          context.eventBus.emit({
            type: 'tool:call',
            sessionId: context.session.data.id,
            participantId: agentConfig.id,
            toolName: toolCall.name,
            arguments: toolArgs,
            timestamp: new Date(),
          });

          const result = await toolExecutor.execute(
            { id: toolCall.id, tool: toolCall.name, args: toolCall.arguments },
            agentConfig,
          );

          // Handle approval_required from ToolExecutor (single-approver / escalation
          // path — reached when there is no callerConfig or caller lacks authority).
          // Only early-exit when there is a scalar approvalRequest (the legacy
          // single-user-approval path). When result.data is present the tool is
          // returning a delegation approval_required payload (e.g. communicate)
          // which must be serialised as a normal tool result so the LLM can read
          // the pending requests and call approval_response.
          if (result.status === 'approval_required' && result.approvalRequest) {
            return {
              status: 'approval_required',
              response: response.content || undefined,
              approvalRequest: result.approvalRequest,
              messagesPersisted: true,
            };
          }

          const resultContent =
            result.status === 'success' || result.status === 'approval_required'
              ? typeof result.data === 'string'
                ? result.data
                : JSON.stringify(result.data)
              : `Error: ${result.error}`;

          resultMap.set(toolCall.id, {
            toolCallId: toolCall.id,
            tool: toolCall.name,
            // Treat delegation approval_required as success so the LLM receives the data.
            status: result.status === 'error' ? 'error' : 'success',
            result: resultContent,
          });

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

        // ── Batch pending approvals ──────────────────────────────────────────
        if (heldCalls.length > 0) {
          const conv = context.conversation;
          const conversationId =
            `${conv.data.initiatorId}__${conv.data.targetId}` +
            (conv.data.name ? `__${conv.data.name}` : '');

          const pendingRequests: PendingApprovalRequest[] = heldCalls.map((h) => ({
            requestId: h.requestId,
            toolCallId: h.toolCallId,
            toolName: h.toolName,
            toolArguments: h.toolArguments,
          }));

          // Capture current loop state for the resume continuation
          const capturedIterations = iterations;
          const capturedResultMap = resultMap;
          const capturedHeldCalls = heldCalls;
          const capturedToolCalls = response.toolCalls;

          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const self = this;

          const resume = async (
            decisions: Map<string, { approved: boolean; reason?: string }>,
          ): Promise<RuntimeResult> => {
            // Execute each held tool per caller decision
            for (const held of capturedHeldCalls) {
              const decision = decisions.get(held.requestId);
              let callResult: ToolCallResult;

              if (decision?.approved !== false) {
                // Approved (or no explicit decision — default to approved).
                // Execute the tool directly, bypassing ToolExecutor/AuthEngine re-authorization:
                // the caller's decision IS the authorization grant.
                const tool = context.toolRegistry.get(held.toolName);
                const toolExecResult = tool
                  ? await tool.execute(held.toolArguments, context)
                  : { status: 'error' as const, error: `Unknown tool: ${held.toolName}` };

                const resultContent =
                  toolExecResult.status === 'success'
                    ? typeof toolExecResult.data === 'string'
                      ? toolExecResult.data
                      : JSON.stringify(toolExecResult.data)
                    : `Error: ${toolExecResult.error}`;

                callResult = {
                  toolCallId: held.toolCallId,
                  tool: held.toolName,
                  status: toolExecResult.status === 'success' ? 'success' : 'error',
                  result: resultContent,
                };

                context.eventBus.emit({
                  type: 'tool:result',
                  sessionId: context.session.data.id,
                  participantId: agentConfig.id,
                  toolName: held.toolName,
                  result: {
                    success: toolExecResult.status === 'success',
                    output: resultContent,
                  },
                  timestamp: new Date(),
                });
              } else {
                // Rejected
                const reason =
                  decision.reason ??
                  `Tool "${held.toolName}" was rejected by ${context.callingParticipantId}.`;
                callResult = {
                  toolCallId: held.toolCallId,
                  tool: held.toolName,
                  status: 'error',
                  result: `Rejected: ${reason}`,
                };
              }

              capturedResultMap.set(held.toolCallId, callResult);
            }

            // Reconstruct tool results in original LLM tool-call order
            const orderedResults: ToolCallResult[] = capturedToolCalls.map((tc) => {
              const r = capturedResultMap.get(tc.id);
              return (
                r ?? {
                  toolCallId: tc.id,
                  tool: tc.name,
                  status: 'error' as const,
                  result: `Error: no result recorded for tool call ${tc.id}`,
                }
              );
            });

            const toolResultMessage = createMessage(
              'user',
              agentConfig.id,
              '',
              undefined,
              orderedResults,
            );
            // Append to conversation (persists to disk) instead of local array
            await context.conversation.appendMessage(toolResultMessage);

            // Clear this batch from the registry and continue the loop
            context.pendingApprovalRegistry.clear(conversationId);

            return self.runLoop(
              capturedIterations,
              context,
              agentConfig,
              runtimeConfig,
              provider,
              toolDefinitions,
            );
          };

          context.pendingApprovalRegistry.store(conversationId, {
            conversationId,
            requestingParticipantId: agentConfig.id,
            callingParticipantId: context.callingParticipantId!,
            requests: pendingRequests,
            resume,
          });

          // ── Persist approval state to conversation ────────────────────────
          // Build approval_pending tool results for held calls so the
          // conversation on disk reflects the pending state.
          const pendingToolResults: ToolCallResult[] = heldCalls.map((h) => ({
            toolCallId: h.toolCallId,
            tool: h.toolName,
            status: 'approval_pending' as const,
            result: JSON.stringify({
              approvalId: pendingRequests.find((r) => r.toolCallId === h.toolCallId)?.requestId,
              arguments: h.toolArguments,
            }),
          }));

          // Merge with already-executed results (some tools in the same
          // iteration may have already executed if they didn't need approval).
          const allResults: ToolCallResult[] = response.toolCalls.map((tc) => {
            const pending = pendingToolResults.find((r) => r.toolCallId === tc.id);
            if (pending) return pending;
            const executed = resultMap.get(tc.id);
            return (
              executed ?? {
                toolCallId: tc.id,
                tool: tc.name,
                status: 'error' as const,
                result: `No result for ${tc.id}`,
              }
            );
          });

          await context.conversation.appendMessage(
            createMessage('user', agentConfig.id, '', undefined, allResults),
          );

          return {
            status: 'approval_required',
            response: response.content || undefined,
            pendingApprovals: {
              conversationId,
              requests: pendingRequests,
            },
            messagesPersisted: true,
          };
        }

        // ── No pending approvals — reconstruct ordered results and continue ──
        const allToolResults: ToolCallResult[] = response.toolCalls.map((tc) => {
          const r = resultMap.get(tc.id);
          return (
            r ?? {
              toolCallId: tc.id,
              tool: tc.name,
              status: 'error' as const,
              result: `Error: no result recorded for tool call ${tc.id}`,
            }
          );
        });

        const toolResultMessage = createMessage(
          'user',
          agentConfig.id,
          '',
          undefined,
          allToolResults,
        );
        // Append to conversation (persists to disk) instead of local array
        await context.conversation.appendMessage(toolResultMessage);

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
          messagesPersisted: true,
        };
      }
    }

    // Iteration limit reached
    return {
      status: 'error',
      error:
        `Agent "${agentConfig.name}" reached the maximum iteration limit ` +
        `(${runtimeConfig.maxIterations}). The agent may be stuck in a loop.`,
      messagesPersisted: true,
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
   *
   * Protected so test subclasses can inject a mock provider without hitting
   * real API keys or network calls.
   */
  protected createProvider(agentConfig: AgentConfig, context: RuntimeContext): LLMProvider {
    const providerName = agentConfig.model.provider;

    // Look up any stored config for this provider (may be undefined for built-ins
    // that rely purely on env vars).
    const storedConfig = context.config.getProviderConfig(providerName);

    // Determine adapter type: explicit `type` field > `provider` field > built-in
    // name for the three known providers > 'openai-compatible' for custom names.
    const builtins = new Set(['anthropic', 'openai', 'openrouter']);
    const adapterType =
      storedConfig?.type ??
      storedConfig?.provider ??
      (builtins.has(providerName) ? providerName : 'openai-compatible');

    const apiKey = context.config.resolveApiKey(providerName);
    const isLocalCompatible = adapterType === 'openai-compatible';

    if (!apiKey && !isLocalCompatible) {
      throw new Error(
        `No API key found for provider "${providerName}". ` +
          `Set it via 'legion config set-provider' or the appropriate environment variable.`,
      );
    }

    return createProvider({
      ...storedConfig,
      type: adapterType,
      name: providerName,
      // Provider field kept for backward compat inside the factory
      provider: adapterType,
      apiKey: apiKey ?? 'local',
      defaultModel: agentConfig.model.model,
    });
  }
}
