import type { FastifyInstance } from 'fastify';
import type { Workspace } from '@legion-collective/core';
import { readFile, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

export async function fileRoutes(fastify: FastifyInstance, opts: { workspace: Workspace }): Promise<void> {
  const { workspace } = opts;

  fastify.get('/files/tree', async (request) => {
    const { path: dirPath, depth } = request.query as { path?: string; depth?: string };
    const target = resolve(workspace.root, dirPath ?? '.');
    const maxDepth = parseInt(depth ?? '2', 10);
    return listDirectory(target, workspace.root, maxDepth);
  });

  fastify.get('/files/content', async (request, reply) => {
    const { path: filePath } = request.query as { path?: string };
    if (!filePath) {
      return reply.code(400).send({ error: 'path query parameter is required' });
    }
    const target = resolve(workspace.root, filePath);
    if (!target.startsWith(workspace.root)) {
      return reply.code(403).send({ error: 'Path outside workspace' });
    }
    try {
      const content = await readFile(target, 'utf-8');
      const info = await stat(target);
      return {
        path: relative(workspace.root, target),
        content,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      };
    } catch {
      return reply.code(404).send({ error: 'File not found' });
    }
  });

  // File writes must go through the tool gateway so authorization policies
  // (auto / requires_approval / deny) are enforced uniformly. Direct writes
  // via this route are intentionally not supported.
  fastify.put('/files/content', async (_request, reply) => {
    return reply.code(501).send({
      error: 'Direct file writes are not supported. Use POST /api/tools/file_write/execute to write files through the authorization layer.',
    });
  });
}

async function listDirectory(
  dirPath: string,
  root: string,
  maxDepth: number,
  currentDepth: number = 0,
): Promise<FileTreeEntry[]> {
  const { readdir, stat: fsStat } = await import('node:fs/promises');
  const entries: FileTreeEntry[] = [];

  try {
    const items = await readdir(dirPath);
    for (const item of items) {
      if (item === '.git' || item === 'node_modules' || item === '.legion') continue;
      const fullPath = resolve(dirPath, item);
      try {
        const info = await fsStat(fullPath);
        const entry: FileTreeEntry = {
          name: item,
          path: relative(root, fullPath),
          type: info.isDirectory() ? 'directory' : 'file',
          size: info.isDirectory() ? undefined : info.size,
        };
        if (info.isDirectory() && currentDepth < maxDepth) {
          entry.children = await listDirectory(fullPath, root, maxDepth, currentDepth + 1);
        }
        entries.push(entry);
      } catch {
        // skip inaccessible files
      }
    }
  } catch {
    // directory doesn't exist
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileTreeEntry[];
}
