import { resolve, relative } from 'node:path';

/**
 * Resolve a relative path and ensure it doesn't escape the project root.
 * @param {string} rootDir - The project root directory
 * @param {string} relativePath - User-provided relative path
 * @returns {{ fullPath: string, error?: string }}
 */
export function safePath(rootDir, relativePath) {
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
