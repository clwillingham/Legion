import type { FastifyInstance } from 'fastify';
import type { Workspace } from '@legion-collective/core';
import { Session } from '@legion-collective/core';
import type { LegionServer } from '../server.js';

export async function sessionRoutes(
  fastify: FastifyInstance,
  opts: { workspace: Workspace; getServer: () => LegionServer },
): Promise<void> {
  const { workspace, getServer } = opts;

  fastify.get('/sessions', async () => {
    return Session.listAll(workspace.storage);
  });

  fastify.post('/sessions', async (request, reply) => {
    const { name } = (request.body ?? {}) as { name?: string };
    const session = Session.create(
      name,
      workspace.storage,
      workspace.runtimeRegistry,
      workspace.collective,
      workspace.eventBus,
    );
    await session.persist();
    const server = getServer();
    server.setSession(session);
    return reply.code(201).send(session.data);
  });

  fastify.get('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = getServer();
    const current = server.session;
    if (current && current.data.id === id) {
      return current.data;
    }
    const session = await Session.resume(
      id,
      workspace.storage,
      workspace.runtimeRegistry,
      workspace.collective,
      workspace.eventBus,
    );
    if (!session) {
      return reply.code(404).send({ error: `Session not found: ${id}` });
    }
    return session.data;
  });

  fastify.get('/sessions/:id/conversations', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = getServer();
    let session = server.session;
    if (!session || session.data.id !== id) {
      session = await Session.resume(
        id,
        workspace.storage,
        workspace.runtimeRegistry,
        workspace.collective,
        workspace.eventBus,
      );
    }
    if (!session) {
      return reply.code(404).send({ error: `Session not found: ${id}` });
    }
    await session.loadAllConversations();
    return session.listConversations().map((c) => c.data);
  });

  fastify.get('/sessions/:id/conversations/:convId/messages', async (request, reply) => {
    const { id, convId } = request.params as { id: string; convId: string };
    const { offset, limit } = request.query as { offset?: string; limit?: string };
    const server = getServer();
    let session = server.session;
    if (!session || session.data.id !== id) {
      session = await Session.resume(
        id,
        workspace.storage,
        workspace.runtimeRegistry,
        workspace.collective,
        workspace.eventBus,
      );
    }
    if (!session) {
      return reply.code(404).send({ error: `Session not found: ${id}` });
    }
    await session.loadAllConversations();

    const conversation = session.listConversations().find((c) => {
      const key = [c.data.initiatorId, c.data.targetId];
      if (c.data.name) key.push(c.data.name);
      return key.join('__') === convId;
    });
    if (!conversation) {
      return reply.code(404).send({ error: `Conversation not found: ${convId}` });
    }

    const messages = conversation.getMessages();
    const start = parseInt(offset ?? '0', 10);
    const count = parseInt(limit ?? '50', 10);
    return {
      messages: messages.slice(start, start + count),
      total: messages.length,
      hasMore: start + count < messages.length,
    };
  });

  fastify.post('/sessions/:id/activate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = getServer();

    // If already active, nothing to do
    const current = server.session;
    if (current && current.data.id === id) {
      return current.data;
    }

    const session = await Session.resume(
      id,
      workspace.storage,
      workspace.runtimeRegistry,
      workspace.collective,
      workspace.eventBus,
    );
    if (!session) {
      return reply.code(404).send({ error: `Session not found: ${id}` });
    }
    server.setSession(session);
    return session.data;
  });

  fastify.post('/sessions/:id/send', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { target, message, conversation } = request.body as {
      target: string;
      message: string;
      conversation?: string;
    };

    if (!target || !message) {
      return reply.code(400).send({ error: 'target and message are required' });
    }

    const server = getServer();
    let session = server.session;
    if (!session || session.data.id !== id) {
      return reply
        .code(400)
        .send({ error: 'Session is not the active session. Create or resume it first.' });
    }

    const result = await session.send(
      'user',
      target,
      message,
      conversation,
      server.createContext(),
    );
    return result;
  });
}
