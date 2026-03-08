import type { Tool, ToolResult, JSONSchema } from './Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';

/**
 * communicate — allows a participant to send a message to another participant.
 *
 * This is the primary inter-agent communication tool. When invoked,
 * it uses Session.send() to dispatch the message through the proper
 * Conversation and ParticipantRuntime pipeline.
 *
 * Phase 3.3 behaviour:
 * - Passes the caller's participant ID as `callingParticipantId` in the downstream
 *   RuntimeContext, so the target agent can check caller approval authority.
 * - If the target conversation has pending approvals (paused from a previous call),
 *   immediately returns the pending requests without sending a new message.
 */
export const communicateTool: Tool = {
  name: 'communicate',
  description:
    'Send a message to another participant in the collective. ' +
    'Use this to collaborate with other agents or ask the user a question. ' +
    'If the target agent needs your approval to run a tool, you will receive ' +
    'pending approval requests. Resolve them with the approval_response tool.',

  parameters: {
    type: 'object',
    properties: {
      participantId: {
        type: 'string',
        description: 'The ID of the participant to send a message to.',
      },
      message: {
        type: 'string',
        description: 'The message content to send.',
      },
    },
    required: ['participantId', 'message'],
  } as JSONSchema,

  async execute(
    args: unknown,
    context: RuntimeContext,
  ): Promise<ToolResult> {
    const { participantId, message } = args as {
      participantId: string;
      message: string;
    };

    if (!participantId || !message) {
      return {
        status: 'error',
        error: 'Both participantId and message are required.',
      };
    }

    const { session } = context;
    if (!session) {
      return {
        status: 'error',
        error: 'No active session. Cannot send messages outside a session.',
      };
    }

    // ── Re-call while paused: return pending requests, no new message ────────
    //
    // Compute the conversation key for a potential downstream conversation
    // (callerId → targetId). If that conversation currently has pending
    // approvals in the registry, return them without sending a new message.
    const callerParticipantId = context.participant.id;
    const conversationId =
      `${callerParticipantId}__${participantId}`;

    if (context.pendingApprovalRegistry.hasPending(conversationId)) {
      const batch = context.pendingApprovalRegistry.get(conversationId)!;
      return {
        status: 'approval_required',
        data: {
          message:
            `Conversation with "${participantId}" has pending approval requests. ` +
            `Use the approval_response tool to resolve them.`,
          conversationId: batch.conversationId,
          requestingParticipantId: batch.requestingParticipantId,
          requests: batch.requests,
        },
      };
    }

    try {
      const result = await session.send(
        callerParticipantId,
        participantId,
        message,
        undefined,
        {
          ...context,
          // Downstream agent will see this as the calling participant
          callingParticipantId: callerParticipantId,
          // communicationDepth is incremented by Session/Conversation
          communicationDepth: context.communicationDepth + 1,
        },
      );

      // Surface pending approvals as a structured tool result
      if (result.status === 'approval_required' && result.pendingApprovals) {
        return {
          status: 'approval_required',
          data: {
            message:
              `Agent "${participantId}" needs your approval to run the following tools. ` +
              `Use the approval_response tool to approve or reject each request.`,
            conversationId: result.pendingApprovals.conversationId,
            requestingParticipantId: participantId,
            requests: result.pendingApprovals.requests,
          },
        };
      }

      const conversationRef = `${callerParticipantId}__${participantId}`;
      return {
        status: result.status === 'success' ? 'success' : 'error',
        data:
          result.status === 'success'
            ? JSON.stringify({ response: result.response, conversationRef })
            : result.response,
        error: result.error,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: `Failed to communicate with ${participantId}: ${errorMessage}`,
      };
    }
  },
};
