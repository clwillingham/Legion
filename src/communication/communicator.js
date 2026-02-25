import { v4 as uuidv4 } from 'uuid';
import { COMMUNICATOR_DEFINITION } from '../tools/builtin/communicator-tool.js';
import { SuspensionHandler } from '../authorization/suspension-handler.js';

/**
 * The Communicator is the heart of Legion. It is a tool available to
 * every participant that enables direct messaging to any other participant.
 *
 * Communication is recursive — when agent A talks to agent B, and agent B
 * uses the communicator to talk to agent C, a new conversation is created
 * with isolated context. Each conversation maintains its own history.
 *
 * The Communicator handles approval cascading via the SuspensionHandler.
 * When an inner agent's tool loop suspends for approval, the communicator
 * detects this via Promise.race and either:
 * - Prompts the user directly (if the sender is a user)
 * - Returns the approval request to the sender agent (if it has authority)
 *   so the agent can review and call resolve_approval
 * - Propagates upward via the parent SuspensionHandler (if no authority)
 */
export class Communicator {
  #collective;
  #sessionManager;
  #agentRuntime;
  #repl;
  #sessionId;
  #depth = 0;
  #maxDepth;
  #activityLogger;
  #authEngine;
  #pendingApprovalStore;
  /** @type {string[]} Communication chain from outermost to innermost sender */
  #communicationChain = [];

  /**
   * @param {Object} deps
   * @param {import('../collective/collective.js').Collective} deps.collective
   * @param {import('./session-manager.js').SessionManager} deps.sessionManager
   * @param {import('../runtime/agent-runtime.js').AgentRuntime} deps.agentRuntime
   * @param {import('../repl/repl.js').Repl} deps.repl
   * @param {string} deps.sessionId - Current active session
   * @param {number} [deps.maxDepth=10] - Max nesting depth for recursive communication
   * @param {import('../repl/activity-logger.js').ActivityLogger} [deps.activityLogger]
   * @param {import('../authorization/auth-engine.js').AuthEngine} deps.authEngine
   * @param {import('../authorization/pending-approval-store.js').PendingApprovalStore} deps.pendingApprovalStore
   */
  constructor(deps) {
    this.#collective = deps.collective;
    this.#sessionManager = deps.sessionManager;
    this.#agentRuntime = deps.agentRuntime;
    this.#repl = deps.repl;
    this.#sessionId = deps.sessionId;
    this.#maxDepth = deps.maxDepth || 10;
    this.#activityLogger = deps.activityLogger || null;
    this.#authEngine = deps.authEngine;
    this.#pendingApprovalStore = deps.pendingApprovalStore;
  }

  /**
   * Send a message from one participant to another.
   * @param {Object} params
   * @param {string} params.senderId
   * @param {string} params.targetId
   * @param {string} params.message
   * @param {string} [params.sessionName='default']
   * @param {string} [params.activeConversationId] - The conversation the calling tool loop is building
   * @param {import('../authorization/suspension-handler.js').SuspensionHandler} [params.parentSuspensionHandler] - For cascading approvals
   * @returns {Promise<string>} The target's response text
   */
  async send({ senderId, targetId, message, sessionName = 'default', activeConversationId, parentSuspensionHandler }) {
    if (this.#depth >= this.#maxDepth) {
      throw new Error(
        `Maximum communication depth (${this.#maxDepth}) exceeded. ` +
        `This may indicate a circular communication loop.`
      );
    }

    // Resolve participants
    const sender = this.#collective.getParticipant(senderId);
    const target = this.#collective.getParticipant(targetId);
    if (!target) {
      throw new Error(`Unknown participant: "${targetId}"`);
    }

    // Get or create conversation
    const conversation = await this.#sessionManager.getOrCreateConversation(
      this.#sessionId, senderId, targetId, sessionName
    );

    // Check if this conversation is the same one the calling tool loop is building.
    // If so, skip adding sender/response messages to avoid breaking the
    // tool_use → tool_result message ordering that the Anthropic API requires.
    const isActiveConversation = (activeConversationId === conversation.id);

    // Append sender's message (only if not the active tool-loop conversation)
    if (!isActiveConversation) {
      conversation.addMessage(senderId, 'user', [
        { type: 'text', text: message },
      ]);
      await this.#sessionManager.saveConversation(this.#sessionId, conversation);
    }

    // Log communication event
    const senderName = sender ? sender.name : senderId;
    const targetName = target.name || targetId;
    this.#activityLogger?.communication(senderName, targetName, sessionName);

    // Get response from target
    let responseText;

    if (target.type === 'agent') {
      // Push sender onto the communication chain
      this.#communicationChain.push(senderId);
      this.#depth++;
      this.#activityLogger?.pushDepth();
      try {
        const handler = new SuspensionHandler();

        const runPromise = this.#agentRuntime.run({
          agent: target,
          conversation,
          senderId,
          sessionId: this.#sessionId,
          communicationChain: [...this.#communicationChain],
          suspensionHandler: handler,
        });

        // Handle the agent run with suspension support
        responseText = await this.#handleWithSuspensions(
          runPromise, handler, senderId, target.id, parentSuspensionHandler
        );
      } finally {
        this.#depth--;
        this.#communicationChain.pop();
        this.#activityLogger?.popDepth();
      }
      this.#activityLogger?.agentDone(targetName);
    } else if (target.type === 'user') {
      // Display message to user and wait for response
      this.#repl.displayMessage(senderName, message);
      responseText = await this.#repl.prompt(`[Reply to ${senderName}] > `);
    } else {
      throw new Error(`Unknown participant type: "${target.type}"`);
    }

    // Append target's response (only if not the active tool-loop conversation)
    if (!isActiveConversation) {
      conversation.addMessage(targetId, 'assistant', [
        { type: 'text', text: responseText },
      ]);
      await this.#sessionManager.saveConversation(this.#sessionId, conversation);
    }

    return responseText;
  }

  /**
   * Race between the agent runtime completing and suspension signals.
   * Handles approvals based on who the sender is:
   * - User sender: prompt via REPL
   * - Agent sender with authority: return approval request as communicator result
   *   (the agent reviews and calls resolve_approval to submit its decision)
   * - No authority: propagate upward via parent suspension handler
   *
   * @param {Promise<string>} runPromise - The agent runtime's run() promise
   * @param {SuspensionHandler} handler - The suspension handler for this agent run
   * @param {string} senderId - Who called this agent
   * @param {string} targetId - The agent being run
   * @param {SuspensionHandler} [parentSuspensionHandler] - For cascading upward
   * @returns {Promise<string>} The agent's final text response, or an approval request
   */
  async #handleWithSuspensions(runPromise, handler, senderId, targetId, parentSuspensionHandler) {
    let done = false;
    let result;

    // Wrap runPromise to set done flag when it resolves/rejects
    const wrappedRun = runPromise.then(
      (text) => {
        done = true;
        return { type: 'done', text };
      },
      (err) => {
        done = true;
        throw err;
      }
    );

    while (!done) {
      const raceResult = await Promise.race([
        wrappedRun,
        handler.waitForSuspension().then(signal => ({ type: 'suspended', ...signal })),
      ]);

      if (raceResult.type === 'done') {
        result = raceResult.text;
        break;
      }

      // Suspension detected — an inner agent needs approval
      const { pendingApprovals, resolve: resolveDecisions } = raceResult;

      const sender = this.#collective.getParticipant(senderId);
      const canApprove = this.#authEngine.canApprove(senderId, targetId);

      if (sender && sender.type === 'user') {
        // User sender: prompt directly via REPL for each approval
        const decisions = new Map();
        for (const pa of pendingApprovals) {
          const request = {
            id: pa.id,
            requesterId: pa.requesterId,
            toolName: pa.toolName,
            toolInput: pa.toolInput,
            toolCallId: pa.toolCallId,
            status: 'pending',
            timestamp: new Date().toISOString(),
          };
          const decision = await this.#repl.promptApproval(request);
          decisions.set(pa.toolCallId, decision);
          this.#activityLogger?.approvalDecision(sender.name || senderId, pa.toolName, decision);
        }
        resolveDecisions(decisions);
        // Continue loop — agent may need more approvals in subsequent iterations
      } else if (canApprove) {
        // Agent with approval authority: store the request and return early.
        // The agent will see the approval details as the communicator tool_result,
        // review them, and call resolve_approval to submit its decision.
        // resolve_approval will wait for runPromise to complete and return the
        // inner agent's final response.
        const requestId = uuidv4();

        this.#pendingApprovalStore.set(requestId, {
          pendingApprovals,
          resolve: resolveDecisions,
          targetId,
          runPromise,
          handler,
        });

        this.#activityLogger?.approvalRequested(
          pendingApprovals[0]?.requesterId || targetId,
          pendingApprovals.map(pa => pa.toolName).join(', '),
          sender?.name || senderId
        );

        // Format the approval request as the communicator's return value
        const toolDetails = pendingApprovals.map(pa => {
          const inputStr = JSON.stringify(pa.toolInput, null, 2);
          return `  Tool: ${pa.toolName}\n  Arguments: ${inputStr}\n  Requested by: ${pa.requesterId}`;
        }).join('\n\n');

        result = [
          `APPROVAL REQUEST (ID: ${requestId})`,
          ``,
          `The following tool call(s) require your approval:`,
          ``,
          toolDetails,
          ``,
          `You have the authority to approve or reject this request.`,
          `Use the resolve_approval tool with requestId "${requestId}" and your decision ("approved" or "rejected").`,
        ].join('\n');

        // Return early — don't wait for runPromise.
        // The inner session stays suspended until the agent calls resolve_approval.
        break;
      } else if (parentSuspensionHandler) {
        // Cannot approve and has parent: propagate up the chain
        const parentDecisions = await parentSuspensionHandler.requestApproval(pendingApprovals);
        resolveDecisions(parentDecisions);
      } else {
        // Cannot approve and no parent handler: reject all as last resort
        const decisions = new Map();
        for (const pa of pendingApprovals) {
          decisions.set(pa.toolCallId, 'rejected');
          this.#activityLogger?.approvalDecision('system', pa.toolName, 'rejected');
        }
        resolveDecisions(decisions);
      }
    }

    return result;
  }

  /**
   * Get the tool definition for the communicator.
   * @returns {import('../providers/provider.js').ToolDefinition}
   */
  static getToolDefinition() {
    return COMMUNICATOR_DEFINITION;
  }
}
