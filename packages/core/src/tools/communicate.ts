import type { Tool, ToolResult, JSONSchema } from './Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';

/**
 * communicate — allows a participant to send a message to another participant.
 *
 * This is the primary inter-agent communication tool. When invoked,
 * it uses Session.send() to dispatch the message through the proper
 * Conversation and ParticipantRuntime pipeline.
 */
export const communicateTool: Tool = {
  name: 'communicate',
  description:
    'Send a message to another participant in the collective. ' +
    'Use this to collaborate with other agents or ask the user a question.',

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

    try {
      const result = await session.send(
        context.participant.id,
        participantId,
        message,
        undefined,
        context,
      );

      return {
        status: result.status === 'success' ? 'success' : 'error',
        data: result.response,
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
