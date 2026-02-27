import type { RuntimeContext } from './ParticipantRuntime.js';
import type { ToolResult, ToolCall } from '../tools/Tool.js';
import { AuthEngine } from '../authorization/AuthEngine.js';
import type { ParticipantConfig } from '../collective/Participant.js';

/**
 * ToolExecutor — dispatches tool calls, checks authorization, and collects results.
 *
 * Used by AgentRuntime to execute tools during the agentic loop.
 * The ToolExecutor checks the participant's authorization policy for each tool
 * before executing, and handles approval requests when needed.
 */
export class ToolExecutor {
  private context: RuntimeContext;
  private authEngine: AuthEngine;

  constructor(context: RuntimeContext, authEngine?: AuthEngine) {
    this.context = context;
    this.authEngine = authEngine ?? new AuthEngine();
  }

  /**
   * Execute a single tool call, checking authorization first.
   *
   * The authorization flow:
   * - auto: execute immediately
   * - deny: return rejected
   * - requires_approval: delegate to ApprovalHandler (which prompts the user)
   *   - If approved: execute the tool
   *   - If rejected: return rejected with reason
   *   - If no handler: return rejected (cannot approve without a handler)
   */
  async execute(toolCall: ToolCall, participant: ParticipantConfig): Promise<ToolResult> {
    const tool = this.context.toolRegistry.get(toolCall.tool);
    if (!tool) {
      return {
        status: 'error',
        error: `Unknown tool: ${toolCall.tool}`,
      };
    }

    // Check authorization (this handles the full approval flow —
    // auto-approve, deny, or prompt via ApprovalHandler).
    // Pass the participant's own tool policies so per-agent approval
    // modes (auto vs requires_approval) are respected.
    const authResult = await this.authEngine.authorize(
      participant.id,
      toolCall.tool,
      toolCall.args as Record<string, unknown>,
      participant.tools,
    );

    if (authResult.authorized) {
      // Authorized (either auto-approved or user approved) — execute the tool
      try {
        this.context.eventBus.emit({
          type: 'tool:call',
          sessionId: this.context.session.data.id,
          participantId: participant.id,
          toolName: toolCall.tool,
          arguments: toolCall.args as Record<string, unknown>,
          timestamp: new Date(),
        });

        const result = await tool.execute(toolCall.args, this.context);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          status: 'error',
          error: `Tool "${toolCall.tool}" failed: ${errorMessage}`,
        };
      }
    } else {
      // Not authorized — return rejection with reason
      return {
        status: 'rejected',
        error: authResult.reason ?? `Tool "${toolCall.tool}" was denied.`,
        reason: authResult.reason,
      };
    }
  }
}
