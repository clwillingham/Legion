import type { FastifyInstance } from 'fastify';
import type { Workspace } from '@legion-collective/core';

export async function collectiveRoutes(fastify: FastifyInstance, opts: { workspace: Workspace }): Promise<void> {
  const { workspace } = opts;

  fastify.get('/collective/participants', async (request) => {
    const { type, status } = request.query as { type?: string; status?: string };
    const filter: { type?: 'agent' | 'user' | 'mock'; status?: 'active' | 'retired' } = {};
    if (type === 'agent' || type === 'user' || type === 'mock') filter.type = type;
    if (status === 'active' || status === 'retired') filter.status = status;
    return workspace.collective.list(filter);
  });

  fastify.get('/collective/participants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const participant = workspace.collective.get(id);
    if (!participant) {
      return reply.code(404).send({ error: `Participant not found: ${id}` });
    }
    return participant;
  });

  fastify.post('/collective/participants', async (request, reply) => {
    const config = request.body as Record<string, unknown>;
    try {
      workspace.collective.save(config as Parameters<typeof workspace.collective.save>[0]);
      await workspace.saveCollective();
      return reply.code(201).send(config);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error });
    }
  });

  fastify.put('/collective/participants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = workspace.collective.get(id);
    if (!existing) {
      return reply.code(404).send({ error: `Participant not found: ${id}` });
    }
    const updates = request.body as Record<string, unknown>;
    const merged = { ...existing, ...updates, id };
    try {
      workspace.collective.save(merged as Parameters<typeof workspace.collective.save>[0]);
      await workspace.saveCollective();
      return merged;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error });
    }
  });

  fastify.delete('/collective/participants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = workspace.collective.get(id);
    if (!existing) {
      return reply.code(404).send({ error: `Participant not found: ${id}` });
    }
    workspace.collective.retire(id);
    await workspace.saveCollective();
    return { status: 'retired', id };
  });
}
