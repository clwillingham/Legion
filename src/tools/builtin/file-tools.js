import { readFile, writeFile, readdir, unlink, mkdir, access, stat } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';

// ─── File Read ───────────────────────────────────────────────────────────────

/** @type {import('../../providers/provider.js').ToolDefinition} */
export const FILE_READ_DEFINITION = {
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

// ─── File Write ──────────────────────────────────────────────────────────────

/** @type {import('../../providers/provider.js').ToolDefinition} */
export const FILE_WRITE_DEFINITION = {
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

// ─── File List ───────────────────────────────────────────────────────────────

/** @type {import('../../providers/provider.js').ToolDefinition} */
export const FILE_LIST_DEFINITION = {
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

// ─── File Delete ─────────────────────────────────────────────────────────────

/** @type {import('../../providers/provider.js').ToolDefinition} */
export const FILE_DELETE_DEFINITION = {
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

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/**
 * Resolve a relative path and ensure it doesn't escape the project root.
 * @param {string} rootDir - The project root directory
 * @param {string} relativePath - User-provided relative path
 * @returns {{ fullPath: string, error?: string }}
 */
function safePath(rootDir, relativePath) {
  const fullPath = resolve(rootDir, relativePath);
  const rel = relative(rootDir, fullPath);

  // Prevent path traversal outside the project root
  if (rel.startsWith('..') || resolve(rootDir, rel) !== fullPath) {
    return { fullPath: '', error: `Path "${relativePath}" escapes the project root` };
  }

  // Prevent access to .legion/ internal directory
  if (rel === '.legion' || rel.startsWith('.legion/') || rel.startsWith('.legion\\')) {
    return { fullPath: '', error: `Cannot access .legion/ directory — it is managed by Legion internally` };
  }

  return { fullPath };
}

// ─── Handler Factories ───────────────────────────────────────────────────────

/**
 * Create the file_read tool handler.
 * @param {string} rootDir - The project root directory
 * @returns {function(Object, Object): Promise<string>}
 */
export function createFileReadHandler(rootDir) {
  return async (input) => {
    const { fullPath, error } = safePath(rootDir, input.path);
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
  };
}

/**
 * Create the file_write tool handler.
 * @param {string} rootDir - The project root directory
 * @returns {function(Object, Object): Promise<string>}
 */
export function createFileWriteHandler(rootDir) {
  return async (input) => {
    const { fullPath, error } = safePath(rootDir, input.path);
    if (error) return JSON.stringify({ error });

    try {
      // Create parent directories if needed
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
  };
}

/**
 * Create the file_list tool handler.
 * @param {string} rootDir - The project root directory
 * @returns {function(Object, Object): Promise<string>}
 */
export function createFileListHandler(rootDir) {
  return async (input) => {
    const dirPath = input.path || '.';
    const { fullPath, error } = safePath(rootDir, dirPath);
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
  };
}

/**
 * Create the file_delete tool handler.
 * @param {string} rootDir - The project root directory
 * @returns {function(Object, Object): Promise<string>}
 */
export function createFileDeleteHandler(rootDir) {
  return async (input) => {
    const { fullPath, error } = safePath(rootDir, input.path);
    if (error) return JSON.stringify({ error });

    try {
      // Verify it's a file, not a directory
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
  };
}
