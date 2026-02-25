import { readdir } from 'node:fs/promises';
import { Tool } from '../tool.js';
import { safePath } from './file-path-utils.js';

/**
 * Tool for listing files and directories in the workspace.
 */
export class FileListTool extends Tool {
  #rootDir;

  /**
   * @param {Object} deps
   * @param {string} deps.rootDir - The project root directory
   */
  constructor({ rootDir }) {
    super();
    this.#rootDir = rootDir;
  }

  get name() { return 'file_list'; }

  get definition() {
    return {
      name: 'file_list',
      description: `List files and directories in a directory within the workspace. The path is relative to the project root. Returns an array of entries with name and type (file or directory).`,
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to the project root (e.g., "src", "src/components"). Defaults to the project root.',
            default: '.',
          },
        },
      },
    };
  }

  async execute(input) {
    const dirPath = input.path || '.';
    const { fullPath, error } = safePath(this.#rootDir, dirPath);
    if (error) return JSON.stringify({ error });

    try {
      const entries = await readdir(fullPath, { withFileTypes: true });
      const result = entries
        .filter(e => {
          // Hide .legion directory from listings at root level
          if (dirPath === '.' && e.name === '.legion') return false;
          return true;
        })
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }))
        .sort((a, b) => {
          // Directories first, then alphabetical
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return JSON.stringify({
        path: dirPath,
        entries: result,
        count: result.length,
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return JSON.stringify({ error: `Directory not found: ${dirPath}` });
      }
      if (err.code === 'ENOTDIR') {
        return JSON.stringify({ error: `"${dirPath}" is a file, not a directory. Use file_read instead.` });
      }
      return JSON.stringify({ error: `Failed to list directory: ${err.message}` });
    }
  }
}
