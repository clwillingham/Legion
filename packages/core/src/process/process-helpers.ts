/**
 * Helpers for process management tools.
 *
 * Pure utility functions for path validation, command blocklist checking,
 * output truncation, and configuration resolution. No side effects,
 * no registry state, no event emission.
 */

import { resolve, isAbsolute } from 'node:path';
import type { ToolResult } from '../tools/Tool.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';
import type { ProcessManagementConfig } from '../config/ConfigSchema.js';

// ── Default configuration ──────────────────────────────────────

/** Default command blocklist — obviously destructive commands */
export const DEFAULT_BLOCKLIST: string[] = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init 0',
  'init 6',
];

export const DEFAULT_SHELL = '/bin/sh';
export const DEFAULT_TIMEOUT_S = 30;
export const DEFAULT_MAX_OUTPUT_BYTES = 51_200; // 50 KB

// ── Path & validation helpers ──────────────────────────────────

/**
 * Resolve and validate the working directory.
 *
 * Returns the absolute cwd path, or a ToolResult error if the path
 * is outside the workspace boundary.
 */
export function resolveCwd(
  cwd: string | undefined,
  workspaceRoot: string,
): string | ToolResult {
  if (!cwd) return workspaceRoot;

  const absolute = isAbsolute(cwd) ? cwd : resolve(workspaceRoot, cwd);

  // Must be within the workspace root (or equal to it)
  if (!absolute.startsWith(workspaceRoot)) {
    return {
      status: 'error',
      error: `Access denied: working directory '${cwd}' is outside the workspace.`,
    };
  }

  return absolute;
}

/**
 * Check whether a command matches the blocklist.
 *
 * Returns the matched blocklist pattern, or null if the command is allowed.
 * Uses case-insensitive substring matching — intentionally simple.
 */
export function isBlocked(command: string, blocklist: string[]): string | null {
  const normalized = command.trim().toLowerCase();
  for (const pattern of blocklist) {
    if (normalized.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

// ── Output truncation ──────────────────────────────────────────

/**
 * Truncate output that exceeds the byte limit.
 *
 * Strategy: keep the first ~40% and last ~40% of the output,
 * insert a truncation marker in the middle. This preserves the
 * beginning (headers, initial errors) and the end (final results,
 * summaries) which are the most useful parts.
 */
export function truncateOutput(
  output: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const byteLength = Buffer.byteLength(output, 'utf-8');

  if (byteLength <= maxBytes) {
    return { text: output, truncated: false };
  }

  // Split into lines for clean truncation
  const lines = output.split('\n');
  const headRatio = 0.4;
  const tailRatio = 0.4;

  const headBytes = Math.floor(maxBytes * headRatio);
  const tailBytes = Math.floor(maxBytes * tailRatio);

  // Collect head lines
  const headLines: string[] = [];
  let headSize = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line + '\n', 'utf-8');
    if (headSize + lineBytes > headBytes && headLines.length > 0) break;
    headLines.push(line);
    headSize += lineBytes;
  }

  // Collect tail lines (from the end)
  const tailLines: string[] = [];
  let tailSize = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line + '\n', 'utf-8');
    if (tailSize + lineBytes > tailBytes && tailLines.length > 0) break;
    tailLines.unshift(line);
    tailSize += lineBytes;
  }

  const truncatedBytes = byteLength - headSize - tailSize;
  const marker = `\n[... ${truncatedBytes} bytes truncated ...]\n`;

  return {
    text: headLines.join('\n') + marker + tailLines.join('\n'),
    truncated: true,
  };
}

// ── Configuration resolution ───────────────────────────────────

/**
 * Get the processManagement config from context, if available.
 * Returns undefined if config is not accessible (e.g., in tests).
 */
export function getProcessConfig(context: RuntimeContext): ProcessManagementConfig | undefined {
  try {
    return context.config?.get('processManagement') as ProcessManagementConfig | undefined;
  } catch {
    // Config may not be available (e.g., in tests with minimal context)
    return undefined;
  }
}

/**
 * Resolve the shell path from configuration.
 *
 * Resolution order:
 *  1. Workspace config  processManagement.shell
 *  2. Global config     defaults.processManagement.shell
 *  3. Built-in default  /bin/sh
 */
export function resolveShell(context: RuntimeContext): string {
  return getProcessConfig(context)?.shell ?? DEFAULT_SHELL;
}

/**
 * Resolve the command blocklist from configuration.
 */
export function resolveBlocklist(context: RuntimeContext): string[] {
  return getProcessConfig(context)?.blocklist ?? DEFAULT_BLOCKLIST;
}

/**
 * Resolve the default timeout (seconds) from configuration.
 */
export function resolveDefaultTimeout(context: RuntimeContext): number {
  return getProcessConfig(context)?.defaultTimeout ?? DEFAULT_TIMEOUT_S;
}

/**
 * Resolve the max output size (bytes) from configuration.
 */
export function resolveMaxOutputBytes(context: RuntimeContext): number {
  return getProcessConfig(context)?.maxOutputSize ?? DEFAULT_MAX_OUTPUT_BYTES;
}
