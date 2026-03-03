import type { ParticipantConfig } from '../collective/Participant.js';
import type { Conversation } from '../communication/Conversation.js';
import type { Session } from '../communication/Session.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { Config } from '../config/Config.js';
import type { EventBus } from '../events/EventBus.js';
import type { ApprovalRequest } from '../authorization/ApprovalRequest.js';
import type { Storage } from '../workspace/Storage.js';
import type { AuthEngine } from '../authorization/AuthEngine.js';
import type {
  PendingApprovalRegistry,
  PendingApprovalRequest,
} from '../authorization/PendingApprovalRegistry.js';

// ============================================================
// Runtime Context — passed to handleMessage()
// ============================================================

export interface RuntimeContext {
  /** The participant being invoked */
  participant: ParticipantConfig;

  /** The conversation this message belongs to */
  conversation: Conversation;

  /** The owning session */
  session: Session;

  /** Current communication nesting depth */
  communicationDepth: number;

  /** Available tools (runtime resolves which ones to use) */
  toolRegistry: ToolRegistry;

  /** Layered config for limit resolution */
  config: Config;

  /** Event bus for emitting observable events */
  eventBus: EventBus;

  /** Workspace storage for persistence */
  storage: Storage;

  /** Authorization engine for tool call approval */
  authEngine: AuthEngine;

  /**
   * The participant who initiated the current communicate call, if any.
   * Set by the communicate tool when it sends a message to another participant.
   * Used by AgentRuntime to determine whether the caller has authority to
   * approve tools that `requires_approval` in the downstream agent.
   */
  callingParticipantId?: string;

  /**
   * Registry of pending approval batches (paused agent executions).
   * Carried through all nested runtimes so approval_response can
   * locate and resume the right continuation.
   */
  pendingApprovalRegistry: PendingApprovalRegistry;
}

// ============================================================
// Runtime Result — returned from handleMessage()
// ============================================================

export interface RuntimeResult {
  /** Whether the message was handled successfully */
  status: 'success' | 'error' | 'approval_required';

  /** The participant's response text */
  response?: string;

  /** Error message if something went wrong */
  error?: string;

  /** Approval request if the participant needs authorization (legacy — single request) */
  approvalRequest?: ApprovalRequest;

  /**
   * Pending caller-approval requests when an agent's tool calls need to be
   * approved by the participant who invoked them via `communicate`.
   *
   * Present when `status === 'approval_required'` and there are one or more
   * tool calls waiting for the calling participant to approve or reject.
   */
  pendingApprovals?: {
    /** Identifies the paused conversation in PendingApprovalRegistry. */
    conversationId: string;
    /** The individual tool calls awaiting a decision. */
    requests: PendingApprovalRequest[];
  };
}

// ============================================================
// ParticipantRuntime — the core abstraction
// ============================================================

/**
 * Abstract base class for all participant runtimes.
 *
 * Every participant type has a runtime that knows how to handle an incoming
 * message and produce a response:
 *
 * - AgentRuntime:  runs the agentic loop (LLM call → tool exec → repeat)
 * - REPLRuntime:   prompts the user in the terminal and waits
 * - WebRuntime:    pushes message to browser via WebSocket and waits
 * - MockRuntime:   returns scripted responses
 *
 * The Conversation doesn't know or care which runtime it's talking to.
 * It just calls handleMessage() and gets a result.
 */
export abstract class ParticipantRuntime {
  /**
   * Handle an incoming message and produce a response.
   *
   * @param message - The message content to process
   * @param context - Runtime context including participant config, conversation, session, etc.
   * @returns The result of handling the message
   */
  abstract handleMessage(message: string, context: RuntimeContext): Promise<RuntimeResult>;
}
