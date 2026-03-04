import type { FastifyInstance } from 'fastify';
import type { Workspace } from '@legion-collective/core';
import type { LegionServer } from '../server.js';

export async function toolRoutes(
  fastify: FastifyInstance,
  opts: { workspace: Workspace; getServer: () => LegionServer },
): Promise<void> {
  const { workspace, getServer } = opts;

  /**
   * GET /tools — list all registered tools.
   * Returns name, description, and parameter schema for each tool.
   */
  fastify.get('/tools', async () => {
    const tools = workspace.toolRegistry.listAll();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  });

  /**
   * POST /tools/:name/execute — execute a tool as the web user.
   * Body is the tool arguments (passed directly to tool.execute()).
   * Returns the ToolResult.
   */
  fastify.post('/tools/:name/execute', async (request, reply) => {
    const { name } = request.params as { name: string };
    const tool = workspace.toolRegistry.get(name);

    if (!tool) {
      return reply.code(404).send({ error: `Tool not found: ${name}` });
    }

    const server = getServer();
    const context = server.createContext();
    const args = request.body ?? {};

    try {
      const result = await tool.execute(args, context);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({
        status: 'error',
        error,
      });
    }
  });
}
