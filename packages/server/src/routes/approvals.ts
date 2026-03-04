import type { FastifyInstance } from 'fastify';
import type { Workspace } from '@legion-collective/core';
import type { LegionServer } from '../server.js';

export async function approvalRoutes(fastify: FastifyInstance, opts: { workspace: Workspace; getServer: () => LegionServer }): Promise<void> {
  const { workspace, getServer } = opts;

  fastify.get('/approvals/pending', async () => {
    const pending = workspace.pendingApprovalRegistry.listPending();
    return pending.map(conversationId => {
      const batch = workspace.pendingApprovalRegistry.get(conversationId);
      return {
        conversationId,
        requestingParticipantId: batch?.requestingParticipantId,
        callingParticipantId: batch?.callingParticipantId,
        requests: batch?.requests ?? [],
      };
    });
  });

  fastify.post('/approvals/:id/respond', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { approved, reason } = request.body as { approved: boolean; reason?: string };

    const server = getServer();
    const handler = server.getApprovalResponseHandler();
    if (handler) {
      handler(id, approved, reason);
      return { status: 'ok' };
    }

    return reply.code(400).send({ error: 'No approval handler registered' });
  });
}
