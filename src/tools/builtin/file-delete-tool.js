import { unlink, stat } from 'node:fs/promises';
import { Tool } from '../tool.js';
import { safePath } from './file-path-utils.js';

/**
 * Tool for deleting files from the workspace.
 */
export class FileDeleteTool extends Tool {
  #rootDir;

  /**
   * @param {Object} deps
   * @param {string} deps.rootDir - The project root directory
   */
  constructor({ rootDir }) {
    super();
    this.#rootDir = rootDir;
  }

  get name() { return 'file_delete'; }

  get definition() {
    return {
      name: 'file_delete',
      description: `Delete a file in the workspace. The path is relative to the project root directory. Cannot delete directories — only files. Returns success or error.`,
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to the project root (e.g., "src/old-file.js")',
          },
        },
        required: ['path'],
      },
    };
  }

  async execute(input) {
    const { fullPath, error } = safePath(this.#rootDir, input.path);
    if (error) return JSON.stringify({ error });

    try {
      const stats = await stat(fullPath);
      if (stats.isDirectory()) {
        return JSON.stringify({ error: `"${input.path}" is a directory. Only files can be deleted.` });
      }

      await unlink(fullPath);
      return JSON.stringify({
        success: true,
        path: input.path,
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return JSON.stringify({ error: `File not found: ${input.path}` });
      }
      return JSON.stringify({ error: `Failed to delete file: ${err.message}` });
    }
  }
}
