import { readFile } from 'node:fs/promises';
import { Tool } from '../tool.js';
import { safePath } from './file-path-utils.js';

/**
 * Tool for reading file contents from the workspace.
 */
export class FileReadTool extends Tool {
  #rootDir;

  /**
   * @param {Object} deps
   * @param {string} deps.rootDir - The project root directory
   */
  constructor({ rootDir }) {
    super();
    this.#rootDir = rootDir;
  }

  get name() { return 'file_read'; }

  get definition() {
    return {
      name: 'file_read',
      description: `Read the contents of a file in the workspace. The path is relative to the project root directory. Returns the file contents as text. Binary files are not supported.`,
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to the project root (e.g., "src/index.js", "README.md")',
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
      const content = await readFile(fullPath, 'utf-8');
      return JSON.stringify({
        path: input.path,
        content,
        size: content.length,
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return JSON.stringify({ error: `File not found: ${input.path}` });
      }
      if (err.code === 'EISDIR') {
        return JSON.stringify({ error: `"${input.path}" is a directory, not a file. Use file_list instead.` });
      }
      return JSON.stringify({ error: `Failed to read file: ${err.message}` });
    }
  }
}
