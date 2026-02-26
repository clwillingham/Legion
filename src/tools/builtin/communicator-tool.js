import { v4 as uuidv4 } from 'uuid';
import { Tool } from '../tool.js';
import { SuspensionHandler } from '../../authorization/suspension-handler.js';

/**
 * The CommunicatorTool is the heart of Legion. It enables direct messaging
 * between any two participants in the collective.
 *
 * Communication is recursive — when agent A talks to agent B, and agent B
 * uses the communicator to talk to agent C, a new session is created
 * with isolated context. Each session maintains its own history.
 *
 * This tool handles approval cascading via the SuspensionHandler.
 * When an inner agent's tool loop suspends for approval, the communicator
 * detects this via Promise.race and either:
 * - Prompts the user directly (if the sender is a user)
 * - Returns the approval request to the sender agent (if it has authority)
 *   so the agent can review and call resolve_approval
 * - Propagates upward via the parent SuspensionHandler (if no authority)
 */
export class CommunicatorTool extends Tool {
  #collective;
  #sessionStore;
  #repl;
  #runId;
  #authEngine;
  #pendingApprovalStore;
  #activityLogger;
  #deps;

  #depth = 0;
  #maxDepth;
  /** @type {string[]} Communication chain from outermost to innermost sender */
  #communicationChain = [];

  /**
   * @param {Object} deps
   * @param {import('../../collective/collective.js').Collective} deps.collective
   * @param {import('../../session/session-store.js').SessionStore} deps.sessionStore
   * @param {import('../../repl/repl.js').Repl} deps.repl
   * @param {string} deps.runId - Current active run ID
   * @param {import('../../authorization/auth-engine.js').AuthEngine} deps.authEngine
   * @param {import('../../authorization/pending-approval-store.js').PendingApprovalStore} deps.pendingApprovalStore
   * @param {import('../../repl/activity-logger.js').ActivityLogger} [deps.activityLogger]
   * @param {import('../../runtime/agent-runtime.js').AgentRuntime} deps.agentRuntime
   * @param {number} [deps.maxDepth=10]
   */
  constructor(deps) {
    super();
    this.#collective = deps.collective;
    this.#sessionStore = deps.sessionStore;
    this.#repl = deps.repl;
    this.#runId = deps.runId;
    this.#authEngine = deps.authEngine;
    this.#pendingApprovalStore = deps.pendingApprovalStore;
    this.#activityLogger = deps.activityLogger || null;
    this.#maxDepth = deps.maxDepth || 10;
    // Store all deps so we can pass them to handleMessage
    this.#deps = deps;
  }

  get name() { return 'communicator'; }

  /**
   * Update the active run ID (used when switching sessions).
   * @param {string} runId
   */
  setRunId(runId) {
    this.#runId = runId;
  }

  get definition() {
    return {
      name: 'communicator',
      description: `Send a message to another participant in the collective and receive their response. Use this tool to communicate with any agent or user by their participant ID. You can optionally specify a session name to maintain separate conversation threads with the same participant for different tasks. Each session has its own isolated conversation history. If no session name is given, the "default" session is used. The target participant will receive your message along with the full conversation history for this session, so you do not need to repeat prior context. Returns the target participant's response as a string.`,
      inputSchema: {
        type: 'object',
        properties: {
          targetId: {
            type: 'string',
            description: 'The participant ID of the agent or user to communicate with',
          },
          message: {
            type: 'string',
            description: 'The message to send to the target participant',
          },
          sessionName: {
            type: 'string',
            description: 'Optional name for a parallel conversation session. Use different session names to maintain separate conversation threads with the same participant for different tasks. Defaults to "default".',
          },
        },
        required: ['targetId', 'message'],
      },
    };
  }

  /**
   * Send a message from the calling participant to the target participant.
   *
   * @param {Object} input
   * @param {string} input.targetId
   * @param {string} input.message
   * @param {string} [input.sessionName='default']
   * @param {Object} context
   * @param {string} context.callerId - Who is sending
   * @param {string} [context.activeSessionId] - Session ID the calling tool loop is building
   * @param {import('../../authorization/suspension-handler.js').SuspensionHandler} [context.suspensionHandler] - Parent suspension handler
   * @returns {Promise<string>}
   */
  async execute(input, context) {
    const senderId = context.callerId;
    const targetId = input.targetId;
    const message = input.message;
    const sessionName = input.sessionName || 'default';

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

    // Get or create session (sender=initiator, target=responder)
    const session = await this.#sessionStore.getOrCreateSession(
      this.#runId, senderId, targetId, sessionName
    );

    // Check if this session is the same one the calling tool loop is building.
    // If so, skip adding sender/response messages to avoid breaking the
    // tool_use → tool_result message ordering that the Anthropic API requires.
    const isActiveSession = (context.activeSessionId === session.id);

    // Append sender's message (only if not the active tool-loop session)
    if (!isActiveSession) {
      session.addMessage(senderId, [
        { type: 'text', text: message },
      ]);
      await this.#sessionStore.saveSession(this.#runId, session);
    }

    // Log communication event
    const senderName = sender ? sender.name : senderId;
    const targetName = target.name || targetId;
    this.#activityLogger?.communication(senderName, targetName, sessionName);

    // Get response from target via handleMessage
    let responseText;

    // Push sender onto the communication chain
    this.#communicationChain.push(senderId);
    this.#depth++;
    this.#activityLogger?.pushDepth();
    try {
      if (target.type === 'agent') {
        const handler = new SuspensionHandler();

        // Build deps for the agent's handleMessage
        const handleDeps = {
          agentRuntime: this.#deps.agentRuntime,
          runId: this.#runId,
          communicationChain: [...this.#communicationChain],
          suspensionHandler: handler,
        };

        const runPromise = target.handleMessage({
          session,
          senderId,
          senderName,
          message,
          deps: handleDeps,
        });

        // Handle the agent run with suspension support
        responseText = await this.#handleWithSuspensions(
          runPromise, handler, senderId, target.id, context.suspensionHandler
        );
      } else if (target.type === 'user') {
        responseText = await target.handleMessage({
          session,
          senderId,
          senderName,
          message,
          deps: { repl: this.#repl },
        });
      } else {
        throw new Error(`Unknown participant type: "${target.type}"`);
      }
    } finally {
      this.#depth--;
      this.#communicationChain.pop();
      this.#activityLogger?.popDepth();
    }

    if (target.type === 'agent') {
      this.#activityLogger?.agentDone(targetName);
    }

    // Append target's response (only if not the active tool-loop session)
    if (!isActiveSession) {
      session.addMessage(targetId, [
        { type: 'text', text: responseText },
      ]);
      await this.#sessionStore.saveSession(this.#runId, session);
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
   * @param {Promise<string>} runPromise - The agent's handleMessage promise
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
      /** @type {{ type: string, text?: string, pendingApprovals?: import('../../authorization/suspension-handler.js').PendingApproval[], resolve?: (arg0: Map<string, 'approved'|'rejected'>) => void }} */
      const raceResult = await Promise.race([
        wrappedRun,
        handler.waitForSuspension().then(signal => ({ type: 'suspended', ...signal })),
      ]);

      if (raceResult.type === 'done') {
        result = raceResult.text;
        break;
      }

      // Suspension detected — an inner agent needs approval
      const pendingApprovals = /** @type {import('../../authorization/suspension-handler.js').PendingApproval[]} */ (raceResult.pendingApprovals);
      const resolveDecisions = /** @type {(arg0: Map<string, 'approved'|'rejected'>) => void} */ (raceResult.resolve);

      const sender = this.#collective.getParticipant(senderId);
      const canApprove = this.#authEngine.canApprove(senderId, targetId);

      if (sender && sender.type === 'user') {
        // User sender: prompt directly via REPL for each approval
        const decisions = new Map();
        for (const pa of pendingApprovals) {
          /** @type {import('../../authorization/approval-flow.js').ApprovalRequest} */
          const request = {
            id: pa.id,
            requesterId: pa.requesterId,
            toolName: pa.toolName,
            toolInput: pa.toolInput,
            toolCallId: pa.toolCallId,
            status: /** @type {'pending'} */ ('pending'),
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
}
