import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Storage — file-system persistence layer.
 *
 * Provides read/write/list operations scoped to the workspace's
 * .legion/ directory. Used by Session, Conversation, and Collective
 * for persistence.
 */
export class Storage {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * Read a JSON file and parse it.
   */
  async readJSON<T>(relativePath: string): Promise<T> {
    const fullPath = resolve(this.basePath, relativePath);
    const raw = await readFile(fullPath, 'utf-8');
    return JSON.parse(raw) as T;
  }

  /**
   * Write an object as formatted JSON.
   */
  async writeJSON(relativePath: string, data: unknown): Promise<void> {
    const fullPath = resolve(this.basePath, relativePath);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Read a raw text file.
   */
  async readText(relativePath: string): Promise<string> {
    const fullPath = resolve(this.basePath, relativePath);
    return readFile(fullPath, 'utf-8');
  }

  /**
   * Write raw text to a file.
   */
  async writeText(relativePath: string, content: string): Promise<void> {
    const fullPath = resolve(this.basePath, relativePath);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  /**
   * Check if a path exists.
   */
  async exists(relativePath: string): Promise<boolean> {
    try {
      await stat(resolve(this.basePath, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List files in a directory.
   */
  async list(relativePath: string): Promise<string[]> {
    const fullPath = resolve(this.basePath, relativePath);
    try {
      const entries = await readdir(fullPath, { withFileTypes: true });
      return entries.map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * List subdirectories in a directory.
   */
  async listDirs(relativePath: string): Promise<string[]> {
    const fullPath = resolve(this.basePath, relativePath);
    try {
      const entries = await readdir(fullPath, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Ensure a directory exists.
   */
  async ensureDir(relativePath: string): Promise<void> {
    await mkdir(resolve(this.basePath, relativePath), { recursive: true });
  }

  /**
   * Get a sub-storage scoped to a subdirectory.
   */
  scope(relativePath: string): Storage {
    return new Storage(resolve(this.basePath, relativePath));
  }

  /**
   * Get the absolute path for a relative path.
   */
  resolve(relativePath: string): string {
    return resolve(this.basePath, relativePath);
  }
}
