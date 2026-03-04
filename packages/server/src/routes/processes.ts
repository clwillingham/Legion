import type { FastifyInstance } from 'fastify';
import { ProcessRegistry } from '@legion-collective/core';

export async function processRoutes(fastify: FastifyInstance): Promise<void> {

  fastify.get('/processes', async () => {
    const registry = ProcessRegistry.getInstance();
    return registry.list('all').map(p => ({
      processId: p.processId,
      pid: p.pid,
      command: p.command,
      label: p.label,
      state: p.state,
      mode: p.mode,
      exitCode: p.exitCode,
      startedAt: p.startedAt.toISOString(),
    }));
  });

  fastify.get('/processes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const processId = parseInt(id, 10);
    const registry = ProcessRegistry.getInstance();
    const proc = registry.get(processId);
    if (!proc) {
      return reply.code(404).send({ error: `Process not found: ${processId}` });
    }
    return {
      processId: proc.processId,
      pid: proc.pid,
      command: proc.command,
      label: proc.label,
      state: proc.state,
      mode: proc.mode,
      exitCode: proc.exitCode,
      startedAt: proc.startedAt.toISOString(),
      recentOutput: proc.output.tail(100),
    };
  });

  fastify.post('/processes/:id/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    const processId = parseInt(id, 10);
    const registry = ProcessRegistry.getInstance();
    try {
      await registry.stop(processId);
      return { status: 'stopped', processId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error });
    }
  });
}
