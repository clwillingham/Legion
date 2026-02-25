import { v4 as uuidv4 } from 'uuid';

/**
 * @typedef {Object} ToolCall
 * @property {string} id - Tool use ID (for matching results)
 * @property {string} name - Tool name
 * @property {Object} input - Tool arguments
 */

/**
 * @typedef {Object} ToolResult
 * @property {string} toolUseId
 * @property {string} content
 * @property {boolean} [isError]
 */

/**
 * Executes tool calls with authorization checks and approval support.
 *
 * Uses a three-phase execution model:
 * 1. Pre-scan ALL tool calls for authorization (before executing any)
 * 2. If any need approval, batch-request decisions via ApprovalFlow
 *    (this may block transparently while approvals cascade up the chain)
 * 3. Execute approved tools, return rejections for rejected ones
 *
 * When approval is needed and the caller is an agent, the execution
 * transparently suspends via the SuspensionHandler → ApprovalFlow bridge.
 * The communicator detects the suspension and handles it.
 */
export class ToolExecutor {
  #toolRegistry;
  #authEngine;
  /** @type {import('../authorization/approval-flow.js').ApprovalFlow|null} */
  #approvalFlow = null;

  /**
   * @param {Object} deps
   * @param {import('../tools/tool-registry.js').ToolRegistry} deps.toolRegistry
   * @param {import('../authorization/auth-engine.js').AuthEngine} deps.authEngine
   */
  constructor({ toolRegistry, authEngine }) {
    this.#toolRegistry = toolRegistry;
    this.#authEngine = authEngine;
  }

  /**
   * Late-bind the approval flow to break circular dependency.
   * @param {import('../authorization/approval-flow.js').ApprovalFlow} approvalFlow
   */
  setApprovalFlow(approvalFlow) {
    this.#approvalFlow = approvalFlow;
  }

  /**
   * Execute one or more tool calls for a participant.
   *
   * @param {ToolCall[]} toolCalls
   * @param {import('../collective/participant.js').Participant} caller
   * @param {Object} context
   * @param {string} context.sessionId
   * @param {string} context.senderId - Who initiated communication with this agent
   * @param {string} context.callerId - The participant making the tool calls
   * @param {string[]} [context.communicationChain] - Chain of sender IDs from outermost to innermost
   * @param {string} [context.activeSessionId] - Session ID the calling tool loop is building
   * @param {import('../authorization/suspension-handler.js').SuspensionHandler} [context.suspensionHandler]
   * @returns {Promise<ToolResult[]>}
   */
  async executeAll(toolCalls, caller, context) {
    // Phase 1: Pre-scan all tool calls for authorization
    const authChecks = toolCalls.map(tc => {
      const tool = this.#toolRegistry.get(tc.name);
      if (!tool) {
        return {
          toolCall: tc,
          tool: null,
          decision: { status: 'denied', reason: `Unknown tool "${tc.name}"` },
        };
      }
      const decision = this.#authEngine.evaluate(caller, tc.name, tc.input, context);
      return { toolCall: tc, tool, decision };
    });

    const pendingApprovals = authChecks.filter(ac => ac.decision.status === 'pending_approval');

    // Phase 2: If any need approval, batch-request decisions
    /** @type {Map<string, 'approved'|'rejected'>} */
    let approvalDecisions = new Map();

    if (pendingApprovals.length > 0) {
      if (!this.#approvalFlow) {
        // No approval flow configured — reject all pending
        for (const ac of pendingApprovals) {
          approvalDecisions.set(ac.toolCall.id, 'rejected');
        }
      } else {
        const pendingList = pendingApprovals.map(ac => ({
          id: uuidv4(),
          requesterId: caller.id,
          toolName: ac.toolCall.name,
          toolInput: ac.toolCall.input,
          toolCallId: ac.toolCall.id,
        }));

        // This may block if the suspension handler propagates up the chain
        approvalDecisions = await this.#approvalFlow.requestBatchApproval({
          pendingApprovals: pendingList,
          senderId: context.senderId,
          suspensionHandler: context.suspensionHandler,
        });
      }
    }

    // Phase 3: Execute tools based on decisions
    const results = [];
    for (const { toolCall, tool, decision } of authChecks) {
      // Unknown tool
      if (!tool) {
        results.push({
          toolUseId: toolCall.id,
          content: `Error: Unknown tool "${toolCall.name}"`,
          isError: true,
        });
        continue;
      }

      // Denied by policy
      if (decision.status === 'denied') {
        results.push({
          toolUseId: toolCall.id,
          content: `Tool call denied: ${decision.reason}`,
          isError: true,
        });
        continue;
      }

      // Needed approval — check the decision
      if (decision.status === 'pending_approval') {
        const approvalDecision = approvalDecisions.get(toolCall.id);
        if (approvalDecision !== 'approved') {
          results.push({
            toolUseId: toolCall.id,
            content: `Tool call "${toolCall.name}" was rejected. You can adjust your approach or try a different strategy.`,
          });
          continue;
        }
        // Approved — fall through to execute
      }

      // Execute the tool (allowed or approved)
      try {
        const result = await tool.handler(toolCall.input, {
          ...context,
          callerId: caller.id,
        });
        results.push({
          toolUseId: toolCall.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      } catch (err) {
        results.push({
          toolUseId: toolCall.id,
          content: `Tool execution error: ${err.message}`,
          isError: true,
        });
      }
    }

    return results;
  }
}
