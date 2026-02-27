/**
 * Enhanced file and directory tools (Milestone 2.2).
 *
 * These complement the existing file_read / file_write tools with
 * analysis, search, editing, and filesystem management capabilities.
 */

import {
  stat,
  readdir,
  readFile,
  appendFile,
  writeFile,
  unlink,
  rename,
  mkdir,
} from 'node:fs/promises';
import { resolve, isAbsolute, relative, join, basename, extname } from 'node:path';
import type { Tool, ToolResult, JSONSchema } from './Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';

// ── helpers ────────────────────────────────────────────────────

/** Resolve a user-supplied path and reject anything outside the workspace. */
function resolveSafe(filePath: string): { absolute: string; workspaceRoot: string } | ToolResult {
  const workspaceRoot = process.cwd();
  const absolute = isAbsolute(filePath) ? filePath : resolve(workspaceRoot, filePath);
  if (!absolute.startsWith(workspaceRoot)) {
    return { status: 'error', error: 'Access denied: path is outside the workspace.' };
  }
  return { absolute, workspaceRoot };
}

function isError(r: unknown): r is ToolResult {
  return typeof r === 'object' && r !== null && 'status' in r;
}

// ── file_analyze ───────────────────────────────────────────────

export const fileAnalyzeTool: Tool = {
  name: 'file_analyze',
  description:
    'Return metadata about a file or directory: size, type, line count, ' +
    'last modified time, and extension. Useful for deciding whether to ' +
    'read a file in full or request specific line ranges.',

  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to analyze (relative to workspace root).' },
    },
    required: ['path'],
  } as JSONSchema,

  async execute(args: unknown, _context: RuntimeContext): Promise<ToolResult> {
    const { path: filePath } = args as { path: string };
    if (!filePath) return { status: 'error', error: 'path is required.' };

    const resolved = resolveSafe(filePath);
    if (isError(resolved)) return resolved;

    try {
      const s = await stat(resolved.absolute);

      const info: Record<string, unknown> = {
        path: filePath,
        type: s.isFile() ? 'file' : s.isDirectory() ? 'directory' : 'other',
        size: s.size,
        sizeHuman: formatBytes(s.size),
        modified: s.mtime.toISOString(),
        created: s.birthtime.toISOString(),
      };

      if (s.isFile()) {
        info.extension = extname(filePath) || '(none)';
        // Count lines for text files up to ~10 MB
        if (s.size <= 10 * 1024 * 1024) {
          const content = await readFile(resolved.absolute, 'utf-8');
          info.lineCount = content.split('\n').length;
        } else {
          info.lineCount = '(file too large to count)';
        }
      }

      if (s.isDirectory()) {
        const entries = await readdir(resolved.absolute);
        info.childCount = entries.length;
      }

      return { status: 'success', data: info };
    } catch (error) {
      return { status: 'error', error: `Failed to analyze: ${errMsg(error)}` };
    }
  },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ── directory_list ─────────────────────────────────────────────

export const directoryListTool: Tool = {
  name: 'directory_list',
  description:
    'List the contents of a directory. Returns names, types (file/directory), ' +
    'and sizes. Optionally recurse into subdirectories up to a given depth.',

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path (relative to workspace root). Defaults to ".".',
      },
      depth: {
        type: 'number',
        description:
          'How many levels deep to recurse. 1 = immediate children only (default). ' +
          'Use 0 for just the directory itself.',
      },
      includeHidden: {
        type: 'boolean',
        description: 'Include hidden files/directories (starting with "."). Default false.',
      },
    },
    required: [],
  } as JSONSchema,

  async execute(args: unknown, _context: RuntimeContext): Promise<ToolResult> {
    const {
      path: dirPath = '.',
      depth = 1,
      includeHidden = false,
    } = args as { path?: string; depth?: number; includeHidden?: boolean };

    const resolved = resolveSafe(dirPath);
    if (isError(resolved)) return resolved;

    try {
      const s = await stat(resolved.absolute);
      if (!s.isDirectory()) {
        return { status: 'error', error: `Not a directory: ${dirPath}` };
      }

      const entries = await listDir(
        resolved.absolute,
        resolved.workspaceRoot,
        Math.max(0, Math.min(depth, 5)),
        includeHidden,
      );

      return { status: 'success', data: entries };
    } catch (error) {
      return { status: 'error', error: `Failed to list directory: ${errMsg(error)}` };
    }
  },
};

interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'other';
  size?: number;
  children?: DirEntry[];
}

async function listDir(
  dirAbsolute: string,
  workspaceRoot: string,
  depth: number,
  includeHidden: boolean,
): Promise<DirEntry[]> {
  const names = await readdir(dirAbsolute);
  const entries: DirEntry[] = [];

  for (const name of names) {
    if (!includeHidden && name.startsWith('.')) continue;

    const fullPath = join(dirAbsolute, name);
    try {
      const s = await stat(fullPath);
      const entry: DirEntry = {
        name,
        path: relative(workspaceRoot, fullPath),
        type: s.isFile() ? 'file' : s.isDirectory() ? 'directory' : 'other',
      };
      if (s.isFile()) entry.size = s.size;
      if (s.isDirectory() && depth > 1) {
        entry.children = await listDir(fullPath, workspaceRoot, depth - 1, includeHidden);
      }
      entries.push(entry);
    } catch {
      // Skip entries we can't stat (broken symlinks, permission errors, etc.)
    }
  }

  return entries.sort((a, b) => {
    // Directories first, then alphabetical
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

// ── file_search ────────────────────────────────────────────────

export const fileSearchTool: Tool = {
  name: 'file_search',
  description:
    'Search for files by name pattern (glob-style). Supports "*" and "**" ' +
    'wildcards. Returns matching file paths relative to the workspace root.',

  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description:
          'Glob-style pattern to match file names. Examples: "*.ts", "src/**/*.test.ts", "README*".',
      },
      path: {
        type: 'string',
        description: 'Directory to search in (relative to workspace root). Defaults to ".".',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return. Default 50.',
      },
    },
    required: ['pattern'],
  } as JSONSchema,

  async execute(args: unknown, _context: RuntimeContext): Promise<ToolResult> {
    const {
      pattern,
      path: searchPath = '.',
      maxResults = 50,
    } = args as { pattern: string; path?: string; maxResults?: number };

    if (!pattern) return { status: 'error', error: 'pattern is required.' };

    const resolved = resolveSafe(searchPath);
    if (isError(resolved)) return resolved;

    try {
      const regex = globToRegex(pattern);
      const results: string[] = [];
      await walkDir(resolved.absolute, resolved.workspaceRoot, regex, results, Math.min(maxResults, 200));

      return {
        status: 'success',
        data: {
          pattern,
          matches: results,
          count: results.length,
          truncated: results.length >= Math.min(maxResults, 200),
        },
      };
    } catch (error) {
      return { status: 'error', error: `Search failed: ${errMsg(error)}` };
    }
  },
};

/** Convert a simple glob pattern to a RegExp. */
function globToRegex(glob: string): RegExp {
  let pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex specials (except * and ?)
    .replace(/\*\*/g, '\0DOUBLESTAR\0')     // Placeholder for **
    .replace(/\*/g, '[^/]*')                // * matches anything except /
    .replace(/\?/g, '[^/]')                 // ? matches single char
    .replace(/\0DOUBLESTAR\0/g, '.*');      // ** matches anything including /

  return new RegExp(`^${pattern}$`, 'i');
}

async function walkDir(
  dirAbsolute: string,
  workspaceRoot: string,
  pattern: RegExp,
  results: string[],
  maxResults: number,
): Promise<void> {
  if (results.length >= maxResults) return;

  let names: string[];
  try {
    names = await readdir(dirAbsolute);
  } catch {
    return; // Skip unreadable directories
  }

  for (const name of names) {
    if (results.length >= maxResults) return;
    if (name === '.git' || name === 'node_modules' || name === '.legion') continue;

    const fullPath = join(dirAbsolute, name);
    let s;
    try {
      s = await stat(fullPath);
    } catch {
      continue;
    }

    const relPath = relative(workspaceRoot, fullPath);

    if (s.isFile() && pattern.test(relPath)) {
      results.push(relPath);
    }

    if (s.isDirectory()) {
      await walkDir(fullPath, workspaceRoot, pattern, results, maxResults);
    }
  }
}

// ── file_grep ──────────────────────────────────────────────────

export const fileGrepTool: Tool = {
  name: 'file_grep',
  description:
    'Search file contents for a text string or regular expression. ' +
    'Returns matching lines with line numbers, grouped by file.',

  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The text or regex pattern to search for.',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in (relative to workspace root). Defaults to ".".',
      },
      isRegex: {
        type: 'boolean',
        description: 'Whether the query is a regular expression. Default false.',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Whether the search is case-sensitive. Default false.',
      },
      filePattern: {
        type: 'string',
        description: 'Glob pattern to filter which files to search (e.g. "*.ts"). Default: all text files.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of matching lines to return. Default 100.',
      },
      contextLines: {
        type: 'number',
        description: 'Number of context lines before and after each match. Default 0.',
      },
    },
    required: ['query'],
  } as JSONSchema,

  async execute(args: unknown, _context: RuntimeContext): Promise<ToolResult> {
    const {
      query,
      path: searchPath = '.',
      isRegex = false,
      caseSensitive = false,
      filePattern,
      maxResults = 100,
      contextLines = 0,
    } = args as {
      query: string;
      path?: string;
      isRegex?: boolean;
      caseSensitive?: boolean;
      filePattern?: string;
      maxResults?: number;
      contextLines?: number;
    };

    if (!query) return { status: 'error', error: 'query is required.' };

    const resolved = resolveSafe(searchPath);
    if (isError(resolved)) return resolved;

    let regex: RegExp;
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      regex = isRegex ? new RegExp(query, flags) : new RegExp(escapeRegex(query), flags);
    } catch (error) {
      return { status: 'error', error: `Invalid regex: ${errMsg(error)}` };
    }

    const fileFilter = filePattern ? globToRegex(filePattern) : null;

    try {
      const s = await stat(resolved.absolute);
      const results: GrepMatch[] = [];

      if (s.isFile()) {
        const relPath = relative(resolved.workspaceRoot, resolved.absolute);
        await grepFile(resolved.absolute, relPath, regex, results, Math.min(maxResults, 500), contextLines);
      } else if (s.isDirectory()) {
        await grepDir(
          resolved.absolute, resolved.workspaceRoot, regex, fileFilter,
          results, Math.min(maxResults, 500), contextLines,
        );
      }

      return {
        status: 'success',
        data: {
          query,
          matches: results,
          totalMatches: results.length,
          truncated: results.length >= Math.min(maxResults, 500),
        },
      };
    } catch (error) {
      return { status: 'error', error: `Grep failed: ${errMsg(error)}` };
    }
  },
};

interface GrepMatch {
  file: string;
  line: number;
  text: string;
  context?: string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.gz', '.tar', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib', '.o', '.obj',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
  '.bin', '.dat', '.db', '.sqlite',
]);

function isBinaryPath(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase());
}

async function grepFile(
  absolutePath: string,
  relativePath: string,
  regex: RegExp,
  results: GrepMatch[],
  maxResults: number,
  contextLines: number,
): Promise<void> {
  if (results.length >= maxResults) return;
  if (isBinaryPath(absolutePath)) return;

  let content: string;
  try {
    const s = await stat(absolutePath);
    // Skip files larger than 1 MB
    if (s.size > 1024 * 1024) return;
    content = await readFile(absolutePath, 'utf-8');
  } catch {
    return;
  }

  // Quick binary check: look for null bytes in first 512 chars
  if (content.slice(0, 512).includes('\0')) return;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (results.length >= maxResults) return;
    regex.lastIndex = 0;
    if (regex.test(lines[i])) {
      const match: GrepMatch = {
        file: relativePath,
        line: i + 1,
        text: lines[i],
      };
      if (contextLines > 0) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        match.context = lines.slice(start, end);
      }
      results.push(match);
    }
  }
}

async function grepDir(
  dirAbsolute: string,
  workspaceRoot: string,
  regex: RegExp,
  fileFilter: RegExp | null,
  results: GrepMatch[],
  maxResults: number,
  contextLines: number,
): Promise<void> {
  if (results.length >= maxResults) return;

  let names: string[];
  try {
    names = await readdir(dirAbsolute);
  } catch {
    return;
  }

  for (const name of names) {
    if (results.length >= maxResults) return;
    if (name === '.git' || name === 'node_modules' || name === '.legion') continue;

    const fullPath = join(dirAbsolute, name);
    let s;
    try {
      s = await stat(fullPath);
    } catch {
      continue;
    }

    const relPath = relative(workspaceRoot, fullPath);

    if (s.isFile()) {
      if (fileFilter && !fileFilter.test(basename(fullPath)) && !fileFilter.test(relPath)) {
        continue;
      }
      await grepFile(fullPath, relPath, regex, results, maxResults, contextLines);
    } else if (s.isDirectory()) {
      await grepDir(fullPath, workspaceRoot, regex, fileFilter, results, maxResults, contextLines);
    }
  }
}

// ── file_append ────────────────────────────────────────────────

export const fileAppendTool: Tool = {
  name: 'file_append',
  description:
    'Append content to the end of a file. Creates the file if it does not exist. ' +
    'Parent directories are created automatically.',

  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to workspace root).' },
      content: { type: 'string', description: 'Content to append to the file.' },
    },
    required: ['path', 'content'],
  } as JSONSchema,

  async execute(args: unknown, _context: RuntimeContext): Promise<ToolResult> {
    const { path: filePath, content } = args as { path: string; content: string };

    if (!filePath) return { status: 'error', error: 'path is required.' };
    if (content === undefined || content === null) return { status: 'error', error: 'content is required.' };

    const resolved = resolveSafe(filePath);
    if (isError(resolved)) return resolved;

    try {
      await mkdir(resolve(resolved.absolute, '..'), { recursive: true });
      await appendFile(resolved.absolute, content, 'utf-8');
      return { status: 'success', data: `Appended ${content.length} characters to ${filePath}` };
    } catch (error) {
      return { status: 'error', error: `Failed to append: ${errMsg(error)}` };
    }
  },
};

// ── file_edit ──────────────────────────────────────────────────

export const fileEditTool: Tool = {
  name: 'file_edit',
  description:
    'Edit a file by replacing an exact string with a new string. ' +
    'The oldString must match exactly (including whitespace and indentation). ' +
    'Only the first occurrence is replaced. Use this for surgical edits instead ' +
    'of rewriting entire files.',

  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to workspace root).' },
      oldString: {
        type: 'string',
        description: 'The exact text to find and replace. Must match exactly, including whitespace.',
      },
      newString: {
        type: 'string',
        description: 'The replacement text.',
      },
    },
    required: ['path', 'oldString', 'newString'],
  } as JSONSchema,

  async execute(args: unknown, _context: RuntimeContext): Promise<ToolResult> {
    const { path: filePath, oldString, newString } = args as {
      path: string; oldString: string; newString: string;
    };

    if (!filePath) return { status: 'error', error: 'path is required.' };
    if (!oldString) return { status: 'error', error: 'oldString is required.' };
    if (newString === undefined || newString === null) {
      return { status: 'error', error: 'newString is required (use empty string to delete).' };
    }

    const resolved = resolveSafe(filePath);
    if (isError(resolved)) return resolved;

    try {
      const content = await readFile(resolved.absolute, 'utf-8');

      const index = content.indexOf(oldString);
      if (index === -1) {
        return {
          status: 'error',
          error:
            'oldString not found in file. Make sure it matches exactly, ' +
            'including whitespace, indentation, and line endings.',
        };
      }

      // Check for multiple occurrences
      const secondIndex = content.indexOf(oldString, index + oldString.length);
      if (secondIndex !== -1) {
        return {
          status: 'error',
          error:
            'oldString matches multiple locations in the file. ' +
            'Include more surrounding context to make the match unique.',
        };
      }

      const updated = content.slice(0, index) + newString + content.slice(index + oldString.length);
      await writeFile(resolved.absolute, updated, 'utf-8');

      return {
        status: 'success',
        data: `Successfully edited ${filePath} (replaced ${oldString.length} chars with ${newString.length} chars)`,
      };
    } catch (error) {
      return { status: 'error', error: `Failed to edit file: ${errMsg(error)}` };
    }
  },
};

// ── file_delete ────────────────────────────────────────────────

export const fileDeleteTool: Tool = {
  name: 'file_delete',
  description: 'Delete a file from the workspace.',

  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to delete (relative to workspace root).' },
    },
    required: ['path'],
  } as JSONSchema,

  async execute(args: unknown, _context: RuntimeContext): Promise<ToolResult> {
    const { path: filePath } = args as { path: string };
    if (!filePath) return { status: 'error', error: 'path is required.' };

    const resolved = resolveSafe(filePath);
    if (isError(resolved)) return resolved;

    try {
      const s = await stat(resolved.absolute);
      if (!s.isFile()) {
        return { status: 'error', error: `Not a file: ${filePath}. Use a different tool for directories.` };
      }
      await unlink(resolved.absolute);
      return { status: 'success', data: `Deleted ${filePath}` };
    } catch (error) {
      return { status: 'error', error: `Failed to delete: ${errMsg(error)}` };
    }
  },
};

// ── file_move ──────────────────────────────────────────────────

export const fileMoveTool: Tool = {
  name: 'file_move',
  description:
    'Move or rename a file or directory within the workspace. ' +
    'Parent directories of the destination are created automatically.',

  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source path (relative to workspace root).' },
      destination: { type: 'string', description: 'Destination path (relative to workspace root).' },
    },
    required: ['source', 'destination'],
  } as JSONSchema,

  async execute(args: unknown, _context: RuntimeContext): Promise<ToolResult> {
    const { source, destination } = args as { source: string; destination: string };

    if (!source) return { status: 'error', error: 'source is required.' };
    if (!destination) return { status: 'error', error: 'destination is required.' };

    const resolvedSrc = resolveSafe(source);
    if (isError(resolvedSrc)) return resolvedSrc;

    const resolvedDst = resolveSafe(destination);
    if (isError(resolvedDst)) return resolvedDst;

    try {
      await stat(resolvedSrc.absolute); // Verify source exists

      // Check destination doesn't already exist
      try {
        await stat(resolvedDst.absolute);
        return { status: 'error', error: `Destination already exists: ${destination}` };
      } catch {
        // Good — destination doesn't exist
      }

      // Create parent directories
      await mkdir(resolve(resolvedDst.absolute, '..'), { recursive: true });
      await rename(resolvedSrc.absolute, resolvedDst.absolute);

      return { status: 'success', data: `Moved ${source} → ${destination}` };
    } catch (error) {
      return { status: 'error', error: `Failed to move: ${errMsg(error)}` };
    }
  },
};

// ── export array ───────────────────────────────────────────────

/** All enhanced file tools as an array for bulk registration. */
export const fileTools: Tool[] = [
  fileAnalyzeTool,
  directoryListTool,
  fileSearchTool,
  fileGrepTool,
  fileAppendTool,
  fileEditTool,
  fileDeleteTool,
  fileMoveTool,
];

// ── utility ────────────────────────────────────────────────────

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
