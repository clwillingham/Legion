import { mkdir, readFile, writeFile, readdir, unlink, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/**
 * Manages the .legion/ workspace directory structure.
 * All reads and writes to the .legion/ directory go through this class.
 */
export class Workspace {
  #rootDir;

  /**
   * @param {string} rootDir - Project root directory (parent of .legion/)
   */
  constructor(rootDir) {
    this.#rootDir = rootDir;
  }

  /** @returns {string} Absolute path to .legion/ */
  get legionDir() {
    return join(this.#rootDir, '.legion');
  }

  /** @returns {string} Absolute path to .legion/collective/ */
  get collectiveDir() {
    return join(this.legionDir, 'collective');
  }

  /** @returns {string} Absolute path to .legion/sessions/ */
  get sessionsDir() {
    return join(this.legionDir, 'sessions');
  }

  /** @returns {string} Absolute path to .legion/templates/ */
  get templatesDir() {
    return join(this.legionDir, 'templates');
  }

  /** @returns {string} Project root directory */
  get rootDir() {
    return this.#rootDir;
  }

  /**
   * Check if a .legion/ workspace exists at the root.
   * @returns {Promise<boolean>}
   */
  async exists() {
    try {
      await access(this.legionDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize the .legion/ directory structure.
   * Creates collective/, collective/participants/, sessions/, templates/ subdirectories.
   * @returns {Promise<void>}
   */
  async initialize() {
    await mkdir(join(this.collectiveDir, 'participants'), { recursive: true });
    await mkdir(this.sessionsDir, { recursive: true });
    await mkdir(this.templatesDir, { recursive: true });
  }

  /**
   * Read and parse a JSON file relative to .legion/.
   * @param {string} relativePath - Path relative to .legion/
   * @returns {Promise<Object|null>} Parsed JSON or null if not found
   */
  async readJSON(relativePath) {
    try {
      const content = await readFile(join(this.legionDir, relativePath), 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Write an object as JSON to a file relative to .legion/.
   * Creates parent directories if needed.
   * @param {string} relativePath - Path relative to .legion/
   * @param {Object} data - Data to serialize
   * @returns {Promise<void>}
   */
  async writeJSON(relativePath, data) {
    const fullPath = join(this.legionDir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  /**
   * List all JSON files in a directory relative to .legion/.
   * @param {string} relativePath - Directory path relative to .legion/
   * @returns {Promise<string[]>} Array of filenames (without directory prefix)
   */
  async listJSON(relativePath) {
    try {
      const entries = await readdir(join(this.legionDir, relativePath));
      return entries.filter(f => f.endsWith('.json'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  /**
   * List subdirectories in a directory relative to .legion/.
   * @param {string} relativePath - Directory path relative to .legion/
   * @returns {Promise<string[]>} Array of directory names
   */
  async listDirs(relativePath) {
    try {
      const entries = await readdir(join(this.legionDir, relativePath), { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  /**
   * Delete a JSON file relative to .legion/.
   * @param {string} relativePath - Path relative to .legion/
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteJSON(relativePath) {
    try {
      await unlink(join(this.legionDir, relativePath));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }
}
