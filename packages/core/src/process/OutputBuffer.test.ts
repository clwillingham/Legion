/// <reference types="vitest/globals" />
import { OutputBuffer } from './OutputBuffer.js';

// ============================================================
// append + basic retrieval
// ============================================================

describe('OutputBuffer', () => {
  describe('append and retrieval', () => {
    it('stores and retrieves a single line', () => {
      const buf = new OutputBuffer();
      buf.append('hello world\n');
      expect(buf.lineCount()).toBe(1);
      expect(buf.all()).toBe('hello world');
    });

    it('stores multiple lines from a single chunk', () => {
      const buf = new OutputBuffer();
      buf.append('line1\nline2\nline3\n');
      expect(buf.lineCount()).toBe(3);
      expect(buf.all()).toBe('line1\nline2\nline3');
    });

    it('handles chunks that do not end with newline (partial lines)', () => {
      const buf = new OutputBuffer();
      buf.append('hello');
      // Partial line is not yet committed
      expect(buf.lineCount()).toBe(0);
      buf.append(' world\n');
      expect(buf.lineCount()).toBe(1);
      expect(buf.all()).toBe('hello world');
    });

    it('handles multiple partial chunks forming lines', () => {
      const buf = new OutputBuffer();
      buf.append('part1');
      buf.append('-part2');
      buf.append('-part3\nline2\n');
      expect(buf.lineCount()).toBe(2);
      expect(buf.all()).toBe('part1-part2-part3\nline2');
    });

    it('flushes remaining partial line', () => {
      const buf = new OutputBuffer();
      buf.append('no newline at end');
      expect(buf.lineCount()).toBe(0);
      buf.flush();
      expect(buf.lineCount()).toBe(1);
      expect(buf.all()).toBe('no newline at end');
    });

    it('flush is a no-op when there is no partial line', () => {
      const buf = new OutputBuffer();
      buf.append('complete\n');
      const countBefore = buf.lineCount();
      buf.flush();
      expect(buf.lineCount()).toBe(countBefore);
    });

    it('handles empty strings', () => {
      const buf = new OutputBuffer();
      buf.append('');
      expect(buf.lineCount()).toBe(0);
      expect(buf.byteCount()).toBe(0);
    });

    it('handles empty lines (consecutive newlines)', () => {
      const buf = new OutputBuffer();
      buf.append('a\n\nb\n');
      expect(buf.lineCount()).toBe(3);
      expect(buf.all()).toBe('a\n\nb');
    });

    it('handles Windows-style line endings as content (not split)', () => {
      const buf = new OutputBuffer();
      // \r is just a character; we split on \n only
      buf.append('line1\r\nline2\r\n');
      expect(buf.lineCount()).toBe(2);
      expect(buf.all()).toBe('line1\r\nline2\r');
    });
  });

  // ============================================================
  // tail
  // ============================================================

  describe('tail', () => {
    it('returns the last N lines', () => {
      const buf = new OutputBuffer();
      buf.append('a\nb\nc\nd\ne\n');
      expect(buf.tail(3)).toBe('c\nd\ne');
    });

    it('returns all lines if N exceeds line count', () => {
      const buf = new OutputBuffer();
      buf.append('a\nb\n');
      expect(buf.tail(100)).toBe('a\nb');
    });

    it('returns empty string from empty buffer', () => {
      const buf = new OutputBuffer();
      expect(buf.tail(5)).toBe('');
    });

    it('returns single line when N=1', () => {
      const buf = new OutputBuffer();
      buf.append('first\nsecond\nthird\n');
      expect(buf.tail(1)).toBe('third');
    });
  });

  // ============================================================
  // byte counting
  // ============================================================

  describe('byteCount', () => {
    it('tracks total bytes received', () => {
      const buf = new OutputBuffer();
      buf.append('hello\n');
      expect(buf.byteCount()).toBe(6);
    });

    it('accumulates bytes across multiple appends', () => {
      const buf = new OutputBuffer();
      buf.append('aaa\n');
      buf.append('bbb\n');
      expect(buf.byteCount()).toBe(8);
    });

    it('handles multi-byte characters correctly', () => {
      const buf = new OutputBuffer();
      buf.append('🚀\n');
      // 🚀 is 4 bytes in UTF-8, plus \n = 5
      expect(buf.byteCount()).toBe(5);
    });
  });

  // ============================================================
  // ring buffer (maxLines)
  // ============================================================

  describe('ring buffer', () => {
    it('drops oldest lines when maxLines is exceeded', () => {
      const buf = new OutputBuffer(3);
      buf.append('a\nb\nc\nd\ne\n');
      expect(buf.lineCount()).toBe(3);
      expect(buf.all()).toBe('c\nd\ne');
    });

    it('tracks total lines received even after dropping', () => {
      const buf = new OutputBuffer(2);
      buf.append('a\nb\nc\nd\n');
      expect(buf.lineCount()).toBe(2);
      expect(buf.totalLineCount()).toBe(4);
    });

    it('reports hasDroppedLines correctly', () => {
      const buf = new OutputBuffer(3);
      buf.append('a\nb\n');
      expect(buf.hasDroppedLines()).toBe(false);

      buf.append('c\nd\n');
      expect(buf.hasDroppedLines()).toBe(true);
    });

    it('reports droppedLineCount correctly', () => {
      const buf = new OutputBuffer(3);
      buf.append('a\nb\nc\nd\ne\n');
      expect(buf.droppedLineCount()).toBe(2);
    });

    it('works with maxLines=1', () => {
      const buf = new OutputBuffer(1);
      buf.append('first\nsecond\nthird\n');
      expect(buf.lineCount()).toBe(1);
      expect(buf.all()).toBe('third');
    });

    it('tail works correctly after ring buffer wrapping', () => {
      const buf = new OutputBuffer(5);
      for (let i = 1; i <= 20; i++) {
        buf.append(`line${i}\n`);
      }
      expect(buf.lineCount()).toBe(5);
      expect(buf.tail(3)).toBe('line18\nline19\nline20');
    });

    it('byteCount tracks all bytes even after dropping lines', () => {
      const buf = new OutputBuffer(2);
      buf.append('aaa\nbbb\nccc\n');
      expect(buf.lineCount()).toBe(2);
      // Total bytes = 12 (3 chars + \n) * 3
      expect(buf.byteCount()).toBe(12);
    });
  });

  // ============================================================
  // edge cases
  // ============================================================

  describe('edge cases', () => {
    it('handles very long lines', () => {
      const buf = new OutputBuffer();
      const longLine = 'x'.repeat(100_000);
      buf.append(longLine + '\n');
      expect(buf.lineCount()).toBe(1);
      expect(buf.all().length).toBe(100_000);
    });

    it('handles rapid sequential appends', () => {
      const buf = new OutputBuffer();
      for (let i = 0; i < 100; i++) {
        buf.append(`line${i}\n`);
      }
      expect(buf.lineCount()).toBe(100);
      expect(buf.totalLineCount()).toBe(100);
    });

    it('flush after flush is safe', () => {
      const buf = new OutputBuffer();
      buf.append('data');
      buf.flush();
      buf.flush();
      expect(buf.lineCount()).toBe(1);
    });

    it('append after flush works normally', () => {
      const buf = new OutputBuffer();
      buf.append('first');
      buf.flush();
      buf.append('second\n');
      expect(buf.lineCount()).toBe(2);
      expect(buf.all()).toBe('first\nsecond');
    });

    it('handles only newlines', () => {
      const buf = new OutputBuffer();
      buf.append('\n\n\n');
      expect(buf.lineCount()).toBe(3);
      expect(buf.all()).toBe('\n\n');
    });
  });
});
