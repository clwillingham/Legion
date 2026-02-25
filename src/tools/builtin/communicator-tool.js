/** @type {import('../../providers/provider.js').ToolDefinition} */
export const COMMUNICATOR_DEFINITION = {
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
