import type { FastifyInstance } from 'fastify';
import type { Workspace, WorkspaceConfig } from '@legion-collective/core';

export async function configRoutes(fastify: FastifyInstance, opts: { workspace: Workspace }): Promise<void> {
  const { workspace } = opts;

  fastify.get('/config', async () => {
    return workspace.config.getWorkspace();
  });

  fastify.put('/config', async (request, reply) => {
    const updates = request.body as Partial<WorkspaceConfig>;
    try {
      const current = workspace.config.getWorkspace();
      const merged = { ...current, ...updates };
      await workspace.config.saveWorkspaceConfig(merged);
      return workspace.config.getWorkspace();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error });
    }
  });
}
