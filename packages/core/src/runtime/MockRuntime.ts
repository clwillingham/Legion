import { ParticipantRuntime, RuntimeContext, RuntimeResult } from './ParticipantRuntime.js';
import type { MockConfig } from '../collective/Participant.js';

/**
 * MockRuntime — returns scripted responses for testing.
 *
 * Matches incoming messages against trigger patterns and returns
 * the corresponding scripted response. No LLM calls, no tool execution.
 *
 * Trigger matching:
 * - Exact string match (case-insensitive)
 * - '*' matches any message (default/fallback)
 * - First matching trigger wins
 */
export class MockRuntime extends ParticipantRuntime {
  async handleMessage(message: string, context: RuntimeContext): Promise<RuntimeResult> {
    const mockConfig = context.participant as MockConfig;
    const responses = mockConfig.responses ?? [];

    // Find matching response
    const lowerMessage = message.toLowerCase();

    for (const entry of responses) {
      if (entry.trigger === '*' || lowerMessage.includes(entry.trigger.toLowerCase())) {
        return {
          status: 'success',
          response: entry.response,
        };
      }
    }

    // No match found
    return {
      status: 'success',
      response: `[MockRuntime] No matching response for: "${message}"`,
    };
  }
}
