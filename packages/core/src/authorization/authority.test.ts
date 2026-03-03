/**
 * Tests for authorization/authority.ts — hasAuthority() and ApprovalAuthoritySchema.
 */

import { hasAuthority, ApprovalAuthoritySchema } from './authority.js';
import type { ApprovalAuthority } from './authority.js';

describe('ApprovalAuthoritySchema', () => {
  it('accepts wildcard "*"', () => {
    expect(ApprovalAuthoritySchema.parse('*')).toBe('*');
  });

  it('accepts empty record', () => {
    expect(ApprovalAuthoritySchema.parse({})).toEqual({});
  });

  it('accepts simple array form (list of tool names)', () => {
    const config = { 'coding-agent': ['file_read', 'file_write'] };
    const parsed = ApprovalAuthoritySchema.parse(config);
    expect(parsed).toEqual(config);
  });

  it('accepts rules form with true permission', () => {
    const config = { 'coding-agent': { file_write: true } };
    expect(ApprovalAuthoritySchema.parse(config)).toEqual(config);
  });

  it('accepts rules form with scoped rules', () => {
    const config = {
      'coding-agent': {
        file_write: {
          rules: [
            { mode: 'auto', scope: { paths: ['src/**'] } },
            { mode: 'deny' },
          ],
        },
      },
    };
    expect(ApprovalAuthoritySchema.parse(config)).toBeDefined();
  });

  it('accepts "*" wildcard participant key', () => {
    const config = { '*': { communicate: true } };
    expect(ApprovalAuthoritySchema.parse(config)).toEqual(config);
  });
});

// ── hasAuthority ──────────────────────────────────────────────

describe('hasAuthority()', () => {
  // ── Wildcard authority ────────────────────────────────────

  it('returns true for "*" authority — any participant, any tool', () => {
    expect(hasAuthority('*', 'coding-agent', 'file_write', {})).toBe(true);
    expect(hasAuthority('*', 'any-agent', 'process_exec', { command: 'rm -rf /' })).toBe(true);
  });

  // ── Empty authority ──────────────────────────────────────

  it('returns false when authority is empty record', () => {
    expect(hasAuthority({}, 'coding-agent', 'file_write', {})).toBe(false);
  });

  it('returns false when no entry for requesting participant', () => {
    const authority: ApprovalAuthority = {
      'other-agent': ['file_read'],
    };
    expect(hasAuthority(authority, 'coding-agent', 'file_read', {})).toBe(false);
  });

  // ── Simple array form ────────────────────────────────────

  it('returns true when tool is in the simple array', () => {
    const authority: ApprovalAuthority = {
      'coding-agent': ['file_read', 'file_write', 'process_exec'],
    };
    expect(hasAuthority(authority, 'coding-agent', 'file_read', {})).toBe(true);
    expect(hasAuthority(authority, 'coding-agent', 'file_write', {})).toBe(true);
    expect(hasAuthority(authority, 'coding-agent', 'process_exec', {})).toBe(true);
  });

  it('returns false when tool is NOT in the simple array', () => {
    const authority: ApprovalAuthority = {
      'coding-agent': ['file_read'],
    };
    expect(hasAuthority(authority, 'coding-agent', 'file_write', {})).toBe(false);
  });

  it('uses "*" participant key as fallback', () => {
    const authority: ApprovalAuthority = {
      '*': ['file_read'],
    };
    expect(hasAuthority(authority, 'any-agent', 'file_read', {})).toBe(true);
    expect(hasAuthority(authority, 'another-agent', 'file_read', {})).toBe(true);
  });

  it('prefers specific participant key over "*" fallback', () => {
    const authority: ApprovalAuthority = {
      '*': ['file_write'],
      'coding-agent': ['file_read'], // coding-agent only gets file_read
    };
    // coding-agent entry is used (specific wins), not '*'
    expect(hasAuthority(authority, 'coding-agent', 'file_read', {})).toBe(true);
    expect(hasAuthority(authority, 'coding-agent', 'file_write', {})).toBe(false);
    // other-agent falls back to '*'
    expect(hasAuthority(authority, 'other-agent', 'file_write', {})).toBe(true);
  });

  // ── Rules form with true permission ──────────────────────

  it('returns true for unconditional true permission', () => {
    const authority: ApprovalAuthority = {
      'coding-agent': { file_write: true },
    };
    expect(hasAuthority(authority, 'coding-agent', 'file_write', {})).toBe(true);
  });

  it('returns false when tool not in rules-form entry', () => {
    const authority: ApprovalAuthority = {
      'coding-agent': { file_read: true },
    };
    expect(hasAuthority(authority, 'coding-agent', 'file_write', {})).toBe(false);
  });

  it('uses "*" tool key as fallback in rules form', () => {
    const authority: ApprovalAuthority = {
      'coding-agent': { '*': true },
    };
    expect(hasAuthority(authority, 'coding-agent', 'file_write', {})).toBe(true);
    expect(hasAuthority(authority, 'coding-agent', 'process_exec', { command: 'npm test' })).toBe(true);
  });

  // ── Rules form with scoped rules ──────────────────────────

  it('returns true when scoped rule matches with mode "auto"', () => {
    const authority: ApprovalAuthority = {
      'coding-agent': {
        file_write: {
          rules: [
            { mode: 'auto', scope: { paths: ['src/**'] } },
            { mode: 'deny' },
          ],
        },
      },
    };
    // In scope
    expect(
      hasAuthority(authority, 'coding-agent', 'file_write', { path: 'src/auth.ts' }),
    ).toBe(true);
    // Out of scope — catch-all 'deny' → false
    expect(
      hasAuthority(authority, 'coding-agent', 'file_write', { path: '.env' }),
    ).toBe(false);
  });

  it('returns false when no scoped rule matches', () => {
    const authority: ApprovalAuthority = {
      'coding-agent': {
        file_write: {
          rules: [
            { mode: 'auto', scope: { paths: ['src/**'] } },
            // No catch-all — falls through to undefined → false
          ],
        },
      },
    };
    expect(
      hasAuthority(authority, 'coding-agent', 'file_write', { path: '.env' }),
    ).toBe(false);
  });

  it('returns false when scoped rule matches with mode "deny"', () => {
    const authority: ApprovalAuthority = {
      'coding-agent': {
        file_delete: {
          rules: [
            { mode: 'deny', scope: { paths: ['**'] } }, // deny everything
          ],
        },
      },
    };
    expect(
      hasAuthority(authority, 'coding-agent', 'file_delete', { path: 'src/temp.ts' }),
    ).toBe(false);
  });

  it('evaluates argPatterns in scoped rules', () => {
    const authority: ApprovalAuthority = {
      'coding-agent': {
        process_exec: {
          rules: [
            { mode: 'auto', scope: { argPatterns: { command: '^npm ' } } },
            { mode: 'deny' },
          ],
        },
      },
    };
    expect(
      hasAuthority(authority, 'coding-agent', 'process_exec', { command: 'npm test' }),
    ).toBe(true);
    expect(
      hasAuthority(authority, 'coding-agent', 'process_exec', { command: 'rm -rf /' }),
    ).toBe(false);
  });

  // ── Multiple participants ─────────────────────────────────

  it('handles multiple participant entries independently', () => {
    const authority: ApprovalAuthority = {
      'coding-agent': ['file_read', 'file_write'],
      'qa-agent': ['file_read', 'process_exec'],
    };
    expect(hasAuthority(authority, 'coding-agent', 'file_write', {})).toBe(true);
    expect(hasAuthority(authority, 'coding-agent', 'process_exec', {})).toBe(false);
    expect(hasAuthority(authority, 'qa-agent', 'process_exec', {})).toBe(true);
    expect(hasAuthority(authority, 'qa-agent', 'file_write', {})).toBe(false);
  });
});
