import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import type { Tool, ToolResult, JSONSchema } from './Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';

/**
 * file-write — write content to a file within the workspace.
 *
 * Creates parent directories automatically. Paths are resolved
 * relative to the workspace root.
 */
export const fileWriteTool: Tool = {
  name: 'file_write',
  description:
    'Write content to a file. Paths are relative to the workspace root. ' +
    'Creates the file if it does not exist, or overwrites it if it does. ' +
    'Parent directories are created automatically.',

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to write (relative to workspace root).',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file.',
      },
    },
    required: ['path', 'content'],
  } as JSONSchema,

  async execute(
    args: unknown,
    _context: RuntimeContext,
  ): Promise<ToolResult> {
    const { path: filePath, content } = args as {
      path: string;
      content: string;
    };

    if (!filePath) {
      return { status: 'error', error: 'path is required.' };
    }

    if (content === undefined || content === null) {
      return { status: 'error', error: 'content is required.' };
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
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, 'utf-8');

      return {
        status: 'success',
        data: `Successfully wrote ${content.length} characters to ${filePath}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: `Failed to write file: ${errorMessage}`,
      };
    }
  },
};
