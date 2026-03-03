/**
 * OutputBuffer — ring-buffer for capturing process output.
 *
 * Stores lines of combined stdout/stderr from background processes.
 * Uses a ring buffer strategy: when maxLines is exceeded, the oldest
 * lines are dropped to prevent unbounded memory growth.
 */

export class OutputBuffer {
  private lines: string[] = [];
  private totalBytes = 0;
  private totalLinesReceived = 0;
  private readonly maxLines: number;
  private partial = ''; // Incomplete line from last chunk

  constructor(maxLines = 10_000) {
    this.maxLines = maxLines;
  }

  /**
   * Append raw output (may contain multiple lines or partial lines).
   */
  append(chunk: string): void {
    if (!chunk) return;
    this.totalBytes += Buffer.byteLength(chunk, 'utf-8');

    // Combine with any leftover partial line from the previous chunk
    const text = this.partial + chunk;
    const parts = text.split('\n');

    // The last element is either '' (if chunk ended with \n) or a partial line
    this.partial = parts.pop()!;

    for (const line of parts) {
      this.pushLine(line);
    }
  }

  /**
   * Flush any remaining partial line (call when the process exits).
   */
  flush(): void {
    if (this.partial) {
      this.pushLine(this.partial);
      this.partial = '';
    }
  }

  /**
   * Get the last N lines of output.
   */
  tail(n: number): string {
    const count = Math.min(n, this.lines.length);
    return this.lines.slice(-count).join('\n');
  }

  /**
   * Get all buffered output as a single string.
   */
  all(): string {
    return this.lines.join('\n');
  }

  /**
   * Number of lines currently in the buffer.
   */
  lineCount(): number {
    return this.lines.length;
  }

  /**
   * Total number of lines ever received (including dropped ones).
   */
  totalLineCount(): number {
    return this.totalLinesReceived;
  }

  /**
   * Total bytes received across all chunks.
   */
  byteCount(): number {
    return this.totalBytes;
  }

  /**
   * Whether lines have been dropped due to the ring buffer limit.
   */
  hasDroppedLines(): boolean {
    return this.totalLinesReceived > this.lines.length;
  }

  /**
   * Number of lines that were dropped.
   */
  droppedLineCount(): number {
    return Math.max(0, this.totalLinesReceived - this.lines.length);
  }

  // ── internal ──────────────────────────────────────────────────

  private pushLine(line: string): void {
    this.totalLinesReceived++;

    if (this.lines.length >= this.maxLines) {
      // Ring buffer: drop the oldest line
      this.lines.shift();
    }

    this.lines.push(line);
  }
}
