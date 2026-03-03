import type { Tool, ToolResult, JSONSchema } from './Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';

/**
 * approval_response — resolve one or more pending approval requests.
 *
 * Called by the participant who received `approval_required` from the
 * `communicate` tool. Applying decisions triggers the downstream
 * agent's continuation, which executes the approved tools and resumes
 * the agentic loop. The final result of the downstream agent is returned
 * directly — the caller does NOT need to call `communicate` again.
 *
 * Multiple pending requests (from a single batched iteration) can be
 * resolved in one call by including all their requestIds.
 */
export const approvalResponseTool: Tool = {
  name: 'approval_response',
  description:
    'Resolve one or more pending tool approval requests for a downstream agent. ' +
    'Providing a decision for each requestId. Once all decisions are provided, ' +
    'the downstream agent resumes and its final response is returned directly. ' +
    'Use this after communicate returns pending approval requests.',

  parameters: {
    type: 'object',
    properties: {
      responses: {
        type: 'array',
        description: 'List of approval decisions — one per pending request.',
        items: {
          type: 'object',
          properties: {
            requestId: {
              type: 'string',
              description: 'The ID of the pending approval request to resolve.',
            },
            approved: {
              type: 'boolean',
              description: 'Whether to approve (true) or reject (false) the tool call.',
            },
            reason: {
              type: 'string',
              description: 'Optional reason for the decision (shown to the downstream agent).',
            },
          },
          required: ['requestId', 'approved'],
        },
      },
    },
    required: ['responses'],
  } as JSONSchema,

  async execute(args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const { responses } = args as {
      responses: Array<{ requestId: string; approved: boolean; reason?: string }>;
    };

    if (!Array.isArray(responses) || responses.length === 0) {
      return {
        status: 'error',
        error: 'responses must be a non-empty array of approval decisions.',
      };
    }

    const registry = context.pendingApprovalRegistry;

    // Group responses by conversation batch (each requestId maps to a batch)
    const batchDecisions = new Map<
      string, // conversationId
      Map<string, { approved: boolean; reason?: string }>
    >();

    const unknownIds: string[] = [];

    for (const response of responses) {
      const batch = registry.getByRequestId(response.requestId);
      if (!batch) {
        unknownIds.push(response.requestId);
        continue;
      }

      if (!batchDecisions.has(batch.conversationId)) {
        batchDecisions.set(batch.conversationId, new Map());
      }
      batchDecisions
        .get(batch.conversationId)!
        .set(response.requestId, { approved: response.approved, reason: response.reason });
    }

    if (unknownIds.length > 0 && batchDecisions.size === 0) {
      return {
        status: 'error',
        error: `Unknown requestId(s): ${unknownIds.join(', ')}. They may have already been resolved.`,
      };
    }

    // Resolve each batch
    const results: Array<{ conversationId: string; result: ToolResult }> = [];

    for (const [conversationId, decisions] of batchDecisions) {
      const batch = registry.get(conversationId);
      if (!batch) continue;

      // Validate the caller has authority (belt-and-suspenders, also checked in AgentRuntime)
      if (batch.callingParticipantId !== context.participant.id) {
        results.push({
          conversationId,
          result: {
            status: 'error',
            error:
              `Participant "${context.participant.id}" does not have authority to ` +
              `resolve approvals for conversation "${conversationId}". ` +
              `Expected: "${batch.callingParticipantId}".`,
          },
        });
        continue;
      }

      try {
        // Resume the downstream agent — this runs held tools + continues the loop
        const runtimeResult = await batch.resume(decisions);

        if (runtimeResult.status === 'approval_required' && runtimeResult.pendingApprovals) {
          // The downstream agent hit more approval requirements in a later iteration —
          // surface again for the caller to handle
          results.push({
            conversationId,
            result: {
              status: 'approval_required',
              data: {
                message:
                  `Agent is still running and needs more approvals. ` +
                  `Use approval_response again to continue.`,
                conversationId: runtimeResult.pendingApprovals.conversationId,
                requests: runtimeResult.pendingApprovals.requests,
              },
            },
          });
        } else {
          results.push({
            conversationId,
            result: {
              status: runtimeResult.status === 'success' ? 'success' : 'error',
              data: runtimeResult.response,
              error: runtimeResult.error,
            },
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({
          conversationId,
          result: {
            status: 'error',
            error: `Error resuming agent for conversation "${conversationId}": ${errorMessage}`,
          },
        });
      }
    }

    // For the common single-batch case, return the result directly
    if (results.length === 1) {
      const { result } = results[0];
      if (unknownIds.length > 0) {
        // Attach a warning about unknown IDs
        return {
          ...result,
          data:
            result.status === 'success'
              ? {
                  response: result.data,
                  warning: `Unknown requestId(s) ignored: ${unknownIds.join(', ')}`,
                }
              : result.data,
        };
      }
      return result;
    }

    // Multiple batches — combine results
    const allSuccess = results.every((r) => r.result.status === 'success');
    const combinedData = results.reduce<Record<string, unknown>>((acc, { conversationId, result }) => {
      acc[conversationId] = result.data ?? result.error;
      return acc;
    }, {});

    if (unknownIds.length > 0) {
      combinedData['unknownRequestIds'] = unknownIds;
    }

    return {
      status: allSuccess ? 'success' : 'error',
      data: combinedData,
      error: allSuccess
        ? undefined
        : results
            .filter((r) => r.result.status !== 'success')
            .map((r) => `${r.conversationId}: ${r.result.error}`)
            .join('; '),
    };
  },
};

/**
 * All approval-related tools.
 */
export const approvalTools: readonly Tool[] = [approvalResponseTool] as const;
