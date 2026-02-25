import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Tool } from '../tool.js';
import { safePath } from './file-path-utils.js';

/**
 * Tool for writing file contents to the workspace.
 */
export class FileWriteTool extends Tool {
  #rootDir;

  /**
   * @param {Object} deps
   * @param {string} deps.rootDir - The project root directory
   */
  constructor({ rootDir }) {
    super();
    this.#rootDir = rootDir;
  }

  get name() { return 'file_write'; }

  get definition() {
    return {
      name: 'file_write',
      description: `Write content to a file in the workspace. The path is relative to the project root directory. Creates parent directories if they don't exist. If the file already exists, it will be overwritten.`,
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to the project root (e.g., "src/new-file.js")',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    };
  }

  async execute(input) {
    const { fullPath, error } = safePath(this.#rootDir, input.path);
    if (error) return JSON.stringify({ error });

    try {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, input.content, 'utf-8');

      return JSON.stringify({
        success: true,
        path: input.path,
        size: input.content.length,
      });
    } catch (err) {
      return JSON.stringify({ error: `Failed to write file: ${err.message}` });
    }
  }
}
