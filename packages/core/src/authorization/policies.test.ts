import { describe, it, expect } from 'vitest';
import {
  evaluateScope,
  evaluateRules,
  evaluatePolicy,
  resolvePolicy,
  DEFAULT_TOOL_POLICIES,
  type ScopeCondition,
  type AuthRule,
  type ToolPolicy,
} from './policies.js';

// ============================================================
// evaluateScope
// ============================================================

describe('evaluateScope', () => {
  // ── paths condition ─────────────────────────────────────────

  describe('paths condition', () => {
    it('matches a single path against a glob', () => {
      const scope: ScopeCondition = { paths: ['src/**'] };
      expect(evaluateScope(scope, { path: 'src/foo/bar.ts' })).toBe(true);
    });

    it('rejects a path that does not match any glob', () => {
      const scope: ScopeCondition = { paths: ['src/**'] };
      expect(evaluateScope(scope, { path: 'dist/foo.js' })).toBe(false);
    });

    it('accepts multiple globs — at least one must match', () => {
      const scope: ScopeCondition = { paths: ['src/**', 'lib/**'] };
      expect(evaluateScope(scope, { path: 'lib/utils.ts' })).toBe(true);
      expect(evaluateScope(scope, { path: 'node_modules/x' })).toBe(false);
    });

    it('normalises leading ./ before matching', () => {
      const scope: ScopeCondition = { paths: ['src/**'] };
      expect(evaluateScope(scope, { path: './src/index.ts' })).toBe(true);
    });

    it('returns false when no path-like args exist and paths condition is set', () => {
      const scope: ScopeCondition = { paths: ['src/**'] };
      expect(evaluateScope(scope, { content: 'hello' })).toBe(false);
    });

    it('checks all path-like fields — all must match', () => {
      const scope: ScopeCondition = { paths: ['/safe/**'] };
      // source matches, destination does not → false
      expect(
        evaluateScope(scope, {
          source: '/safe/input.txt',
          destination: '/unsafe/output.txt',
        }),
      ).toBe(false);
      // both match → true
      expect(
        evaluateScope(scope, {
          source: '/safe/input.txt',
          destination: '/safe/output.txt',
        }),
      ).toBe(true);
    });

    it('handles dot files / hidden dirs with dot:true', () => {
      const scope: ScopeCondition = { paths: ['.legion/**'] };
      expect(evaluateScope(scope, { path: '.legion/sessions/s1.json' })).toBe(true);
    });

    it('matches the cwd field', () => {
      const scope: ScopeCondition = { paths: ['/workspace/**'] };
      expect(evaluateScope(scope, { cwd: '/workspace/project' })).toBe(true);
    });

    it('matches the directory field', () => {
      const scope: ScopeCondition = { paths: ['/tmp/**'] };
      expect(evaluateScope(scope, { directory: '/tmp/scratch' })).toBe(true);
    });
  });

  // ── args condition ──────────────────────────────────────────

  describe('args condition', () => {
    it('matches when arg value is in the allowed list', () => {
      const scope: ScopeCondition = { args: { action: ['read', 'list'] } };
      expect(evaluateScope(scope, { action: 'read' })).toBe(true);
    });

    it('rejects when arg value is not in the allowed list', () => {
      const scope: ScopeCondition = { args: { action: ['read', 'list'] } };
      expect(evaluateScope(scope, { action: 'write' })).toBe(false);
    });

    it('rejects when arg field is absent', () => {
      const scope: ScopeCondition = { args: { action: ['read'] } };
      expect(evaluateScope(scope, {})).toBe(false);
    });

    it('rejects when arg value is not a string', () => {
      const scope: ScopeCondition = { args: { count: ['5'] } };
      expect(evaluateScope(scope, { count: 5 })).toBe(false);
    });
  });

  // ── argPatterns condition ───────────────────────────────────

  describe('argPatterns condition', () => {
    it('matches when arg value matches the regex', () => {
      const scope: ScopeCondition = { argPatterns: { message: '^ping' } };
      expect(evaluateScope(scope, { message: 'ping pong' })).toBe(true);
    });

    it('rejects when arg value does not match the regex', () => {
      const scope: ScopeCondition = { argPatterns: { message: '^ping' } };
      expect(evaluateScope(scope, { message: 'pong' })).toBe(false);
    });

    it('rejects when arg field is absent', () => {
      const scope: ScopeCondition = { argPatterns: { message: '.*' } };
      expect(evaluateScope(scope, {})).toBe(false);
    });

    it('rejects on invalid regex instead of throwing', () => {
      const scope: ScopeCondition = { argPatterns: { x: '[invalid' } };
      expect(evaluateScope(scope, { x: 'anything' })).toBe(false);
    });
  });

  // ── AND logic across conditions ─────────────────────────────

  describe('AND logic', () => {
    it('all conditions must pass', () => {
      const scope: ScopeCondition = {
        paths: ['src/**'],
        args: { mode: ['read'] },
      };
      expect(evaluateScope(scope, { path: 'src/index.ts', mode: 'read' })).toBe(true);
      expect(evaluateScope(scope, { path: 'src/index.ts', mode: 'write' })).toBe(false);
      expect(evaluateScope(scope, { path: 'dist/index.js', mode: 'read' })).toBe(false);
    });
  });

  // ── empty scope ─────────────────────────────────────────────

  it('empty scope always matches', () => {
    expect(evaluateScope({}, { path: '/anything', other: 123 })).toBe(true);
    expect(evaluateScope({}, {})).toBe(true);
  });
});

// ============================================================
// evaluateRules
// ============================================================

describe('evaluateRules', () => {
  it('returns the mode of the first matching rule', () => {
    const rules: AuthRule[] = [
      { mode: 'auto', scope: { paths: ['src/**'] } },
      { mode: 'requires_approval' },
    ];
    expect(evaluateRules(rules, { path: 'src/foo.ts' })).toBe('auto');
  });

  it('falls through to the next rule when the first scope does not match', () => {
    const rules: AuthRule[] = [
      { mode: 'auto', scope: { paths: ['src/**'] } },
      { mode: 'requires_approval' },
    ];
    expect(evaluateRules(rules, { path: 'dist/foo.js' })).toBe('requires_approval');
  });

  it('catch-all rule (no scope) always matches', () => {
    const rules: AuthRule[] = [
      { mode: 'deny' },
    ];
    expect(evaluateRules(rules, { whatever: 'value' })).toBe('deny');
  });

  it('returns undefined when no rule matches', () => {
    const rules: AuthRule[] = [
      { mode: 'auto', scope: { paths: ['src/**'] } },
    ];
    expect(evaluateRules(rules, { path: 'dist/foo.js' })).toBeUndefined();
  });

  it('returns undefined for empty rules list', () => {
    expect(evaluateRules([], {})).toBeUndefined();
  });

  it('evaluates rules in order — first match wins', () => {
    const rules: AuthRule[] = [
      { mode: 'deny', scope: { paths: ['**'] } },
      { mode: 'auto' }, // catch-all but never reached
    ];
    expect(evaluateRules(rules, { path: 'src/x.ts' })).toBe('deny');
  });
});

// ============================================================
// evaluatePolicy
// ============================================================

describe('evaluatePolicy', () => {
  it('simple form always resolves', () => {
    const policy: ToolPolicy = { mode: 'auto' };
    expect(evaluatePolicy(policy, {})).toBe('auto');
    expect(evaluatePolicy(policy, { path: 'anywhere' })).toBe('auto');
  });

  it('rules form resolves first matching rule', () => {
    const policy: ToolPolicy = {
      rules: [
        { mode: 'auto', scope: { paths: ['src/**'] } },
        { mode: 'requires_approval' },
      ],
    };
    expect(evaluatePolicy(policy, { path: 'src/index.ts' })).toBe('auto');
    expect(evaluatePolicy(policy, { path: 'dist/index.js' })).toBe('requires_approval');
  });

  it('rules form returns undefined when no rule matches', () => {
    const policy: ToolPolicy = {
      rules: [{ mode: 'auto', scope: { paths: ['src/**'] } }],
    };
    expect(evaluatePolicy(policy, { path: 'dist/x.js' })).toBeUndefined();
  });
});

// ============================================================
// resolvePolicy
// ============================================================

describe('resolvePolicy', () => {
  // ── participant policy wins ──────────────────────────────────

  it('participant simple policy overrides engine and defaults', () => {
    const participantPolicies: Record<string, ToolPolicy> = {
      file_write: { mode: 'auto' },
    };
    expect(resolvePolicy('file_write', { path: 'x' }, participantPolicies)).toBe('auto');
  });

  it('participant rules policy: matching rule wins', () => {
    const participantPolicies: Record<string, ToolPolicy> = {
      file_write: {
        rules: [
          { mode: 'auto', scope: { paths: ['src/**'] } },
          { mode: 'requires_approval' },
        ],
      },
    };
    expect(
      resolvePolicy('file_write', { path: 'src/x.ts' }, participantPolicies),
    ).toBe('auto');
    expect(
      resolvePolicy('file_write', { path: 'dist/x.js' }, participantPolicies),
    ).toBe('requires_approval');
  });

  it('participant rules policy: falls through on no match', () => {
    // Rules list with no catch-all, no match → fall through to engine
    const participantPolicies: Record<string, ToolPolicy> = {
      file_write: {
        rules: [{ mode: 'auto', scope: { paths: ['src/**'] } }],
      },
    };
    const enginePolicies = { file_write: 'deny' as const };
    expect(
      resolvePolicy('file_write', { path: 'dist/x.js' }, participantPolicies, enginePolicies),
    ).toBe('deny');
  });

  // ── engine policy ────────────────────────────────────────────

  it('engine per-tool policy overrides default and built-in', () => {
    const enginePolicies = { file_read: 'deny' as const };
    expect(resolvePolicy('file_read', {}, undefined, enginePolicies)).toBe('deny');
  });

  it('engine default policy overrides built-in defaults', () => {
    expect(
      resolvePolicy('file_read', {}, undefined, undefined, 'deny'),
    ).toBe('deny');
  });

  // ── built-in defaults ────────────────────────────────────────

  it('uses built-in default for known tools', () => {
    // file_read default is 'auto'
    expect(resolvePolicy('file_read', {})).toBe('auto');
    // file_write default is 'requires_approval'
    expect(resolvePolicy('file_write', { path: 'x' })).toBe('requires_approval');
  });

  it('falls back to requires_approval for unknown tools', () => {
    expect(resolvePolicy('unknown_custom_tool', {})).toBe('requires_approval');
  });

  // ── backward compat ──────────────────────────────────────────

  it('is backward compatible: no args provided returns same result', () => {
    // communicate was 'auto' in old system
    expect(resolvePolicy('communicate', {})).toBe('auto');
    // process_exec was 'requires_approval'
    expect(resolvePolicy('process_exec', {})).toBe('requires_approval');
  });
});

// ============================================================
// DEFAULT_TOOL_POLICIES sanity checks
// ============================================================

describe('DEFAULT_TOOL_POLICIES', () => {
  it('all read tools are auto', () => {
    const autoTools = [
      'file_read', 'file_analyze', 'directory_list', 'file_search', 'file_grep',
      'list_participants', 'get_participant',
      'list_sessions', 'list_conversations', 'inspect_session', 'search_history',
      'process_status', 'process_list',
      'communicate',
      'process_stop',
    ];
    for (const tool of autoTools) {
      expect(DEFAULT_TOOL_POLICIES[tool], `${tool} should be auto`).toBe('auto');
    }
  });

  it('all write tools are requires_approval', () => {
    const approvalTools = [
      'file_write', 'file_append', 'file_edit', 'file_delete', 'file_move',
      'create_agent', 'modify_agent', 'retire_agent',
      'process_exec', 'process_start',
    ];
    for (const tool of approvalTools) {
      expect(
        DEFAULT_TOOL_POLICIES[tool],
        `${tool} should be requires_approval`,
      ).toBe('requires_approval');
    }
  });
});
