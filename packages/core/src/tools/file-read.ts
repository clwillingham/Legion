import { readFile, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import type { Tool, ToolResult, JSONSchema } from './Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';

/**
 * file-read — read the contents of a file within the workspace.
 *
 * Supports reading the full file or a specific line range.
 * Paths are resolved relative to the workspace root.
 */
export const fileReadTool: Tool = {
  name: 'file_read',
  description:
    'Read the contents of a file. Paths are relative to the workspace root. ' +
    'Optionally specify startLine and endLine to read a portion of the file.',

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to read (relative to workspace root).',
      },
      startLine: {
        type: 'number',
        description: 'Optional 1-based start line number.',
      },
      endLine: {
        type: 'number',
        description: 'Optional 1-based end line number (inclusive).',
      },
    },
    required: ['path'],
  } as JSONSchema,

  async execute(
    args: unknown,
    _context: RuntimeContext,
  ): Promise<ToolResult> {
    const { path: filePath, startLine, endLine } = args as {
      path: string;
      startLine?: number;
      endLine?: number;
    };

    if (!filePath) {
      return { status: 'error', error: 'path is required.' };
    }

    // For now, resolve from cwd. Workspace root will be injected later.
    const workspaceRoot = process.cwd();

    const absolutePath = isAbsolute(filePath)
      ? filePath
      : resolve(workspaceRoot, filePath);

    // Security: ensure the resolved path is within the workspace root
    if (!absolutePath.startsWith(workspaceRoot)) {
      return {
        status: 'error',
        error: 'Access denied: path is outside the workspace.',
      };
    }

    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        return { status: 'error', error: `Not a file: ${filePath}` };
      }

      const content = await readFile(absolutePath, 'utf-8');

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split('\n');
        const start = Math.max(1, startLine ?? 1) - 1;
        const end = Math.min(lines.length, endLine ?? lines.length);
        const slice = lines.slice(start, end);

        return {
          status: 'success',
          data: slice.join('\n'),
        };
      }

      return {
        status: 'success',
        data: content,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: `Failed to read file: ${errorMessage}`,
      };
    }
  },
};
