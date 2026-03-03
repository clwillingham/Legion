import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Storage } from '../workspace/Storage.js';
import {
  ApprovalLog,
  createApprovalRecordId,
  type ApprovalRecord,
} from './ApprovalLog.js';
import { AuthEngine } from './AuthEngine.js';

// ============================================================
// Helpers
// ============================================================

function makeRecord(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  const now = new Date().toISOString();
  return {
    id: createApprovalRecordId(),
    sessionId: 'session-1',
    requestingParticipantId: 'agent-a',
    decidedByParticipantId: 'system',
    toolName: 'file_read',
    toolArguments: { path: 'src/index.ts' },
    decision: 'auto_approved',
    policyMode: 'auto',
    requestedAt: now,
    resolvedAt: now,
    durationMs: 0,
    ...overrides,
  };
}

// ============================================================
// ApprovalLog.record / get / list
// ============================================================

describe('ApprovalLog', () => {
  let tmpDir: string;
  let storage: Storage;
  let log: ApprovalLog;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'approval-log-test-'));
    storage = new Storage(tmpDir);
    log = new ApprovalLog(storage);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── record & get ─────────────────────────────────────────────

  describe('record + get', () => {
    it('persists a record and retrieves it by ID', async () => {
      const rec = makeRecord({ sessionId: 'sess-1', decision: 'auto_approved' });
      await log.record(rec);
      const fetched = await log.get('sess-1', rec.id);
      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(rec.id);
      expect(fetched?.decision).toBe('auto_approved');
    });

    it('returns undefined for a missing record', async () => {
      const result = await log.get('nonexistent-session', 'approval_missing');
      expect(result).toBeUndefined();
    });

    it('stores records in separate files under <sessionId>/approvals/', async () => {
      const r1 = makeRecord({ sessionId: 'sess-x', id: 'r1' });
      const r2 = makeRecord({ sessionId: 'sess-x', id: 'r2' });
      await log.record(r1);
      await log.record(r2);
      expect(await log.get('sess-x', 'r1')).toBeDefined();
      expect(await log.get('sess-x', 'r2')).toBeDefined();
    });

    it('records for different sessions are isolated', async () => {
      const r1 = makeRecord({ sessionId: 'sess-a', id: 'shared-id' });
      const r2 = makeRecord({ sessionId: 'sess-b', id: 'shared-id' });
      await log.record(r1);
      await log.record(r2);
      const a = await log.get('sess-a', 'shared-id');
      const b = await log.get('sess-b', 'shared-id');
      expect(a?.sessionId).toBe('sess-a');
      expect(b?.sessionId).toBe('sess-b');
    });
  });

  // ── list — basic ─────────────────────────────────────────────

  describe('list', () => {
    it('returns all records for a session', async () => {
      await log.record(makeRecord({ id: 'a', decision: 'auto_approved' }));
      await log.record(makeRecord({ id: 'b', decision: 'rejected' }));
      const results = await log.list('session-1');
      expect(results).toHaveLength(2);
    });

    it('returns empty array when session has no records', async () => {
      const results = await log.list('nonexistent');
      expect(results).toEqual([]);
    });

    it('sorts most-recent first', async () => {
      const older = makeRecord({ id: 'old', requestedAt: '2026-01-01T00:00:00.000Z' });
      const newer = makeRecord({ id: 'new', requestedAt: '2026-01-02T00:00:00.000Z' });
      await log.record(older);
      await log.record(newer);
      const results = await log.list('session-1');
      expect(results[0].id).toBe('new');
      expect(results[1].id).toBe('old');
    });
  });

  // ── list — filters ───────────────────────────────────────────

  describe('list filters', () => {
    beforeEach(async () => {
      await log.record(makeRecord({ id: 'r1', requestingParticipantId: 'agent-a', toolName: 'file_read', decision: 'auto_approved' }));
      await log.record(makeRecord({ id: 'r2', requestingParticipantId: 'agent-a', toolName: 'file_write', decision: 'rejected', policyMode: 'requires_approval' }));
      await log.record(makeRecord({ id: 'r3', requestingParticipantId: 'agent-b', toolName: 'file_read', decision: 'denied', policyMode: 'deny' }));
      await log.record(makeRecord({ id: 'r4', requestingParticipantId: 'agent-b', toolName: 'process_exec', decision: 'approved', policyMode: 'requires_approval' }));
    });

    it('filters by participantId', async () => {
      const results = await log.list('session-1', { participantId: 'agent-a' });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.requestingParticipantId === 'agent-a')).toBe(true);
    });

    it('filters by toolName', async () => {
      const results = await log.list('session-1', { toolName: 'file_read' });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.toolName === 'file_read')).toBe(true);
    });

    it('filters by decision', async () => {
      const denied = await log.list('session-1', { decision: 'denied' });
      expect(denied).toHaveLength(1);
      expect(denied[0].id).toBe('r3');

      const approved = await log.list('session-1', { decision: 'approved' });
      expect(approved).toHaveLength(1);
      expect(approved[0].id).toBe('r4');
    });

    it('applies limit', async () => {
      const results = await log.list('session-1', { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('combines filters', async () => {
      const results = await log.list('session-1', {
        participantId: 'agent-a',
        toolName: 'file_write',
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('r2');
    });
  });
});

// ============================================================
// AuthEngine — approval logging integration
// ============================================================

describe('AuthEngine with approval logging', () => {
  let tmpDir: string;
  let log: ApprovalLog;
  let engine: AuthEngine;
  const SESSION = 'test-session';

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'auth-engine-test-'));
    const storage = new Storage(tmpDir);
    log = new ApprovalLog(storage);
    engine = new AuthEngine({ approvalLog: log });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('logs auto_approved when policy resolves to auto', async () => {
    await engine.authorize('agent-a', 'file_read', { path: 'src/x.ts' }, undefined, SESSION);
    const records = await log.list(SESSION);
    expect(records).toHaveLength(1);
    expect(records[0].decision).toBe('auto_approved');
    expect(records[0].policyMode).toBe('auto');
    expect(records[0].decidedByParticipantId).toBe('system');
    expect(records[0].toolName).toBe('file_read');
    expect(records[0].requestingParticipantId).toBe('agent-a');
  });

  it('logs denied when policy resolves to deny', async () => {
    const deniedEngine = new AuthEngine({
      toolPolicies: { file_read: 'deny' },
      approvalLog: log,
    });
    await deniedEngine.authorize('agent-a', 'file_read', { path: 'x' }, undefined, SESSION);
    const records = await log.list(SESSION);
    expect(records).toHaveLength(1);
    expect(records[0].decision).toBe('denied');
    expect(records[0].policyMode).toBe('deny');
    expect(records[0].reason).toContain('denied by policy');
  });

  it('logs denied when no approval handler is registered', async () => {
    // file_write requires approval by default — with no handler → denied
    await engine.authorize('agent-a', 'file_write', { path: 'x' }, undefined, SESSION);
    const records = await log.list(SESSION);
    expect(records).toHaveLength(1);
    expect(records[0].decision).toBe('denied');
    expect(records[0].policyMode).toBe('requires_approval');
  });

  it('logs approved when handler approves', async () => {
    engine.setApprovalHandler(async () => ({ approved: true }));
    await engine.authorize('agent-a', 'file_write', { path: 'x' }, undefined, SESSION);
    const records = await log.list(SESSION);
    expect(records).toHaveLength(1);
    expect(records[0].decision).toBe('approved');
    expect(records[0].decidedByParticipantId).toBe('user');
    expect(records[0].policyMode).toBe('requires_approval');
  });

  it('logs rejected when handler rejects', async () => {
    engine.setApprovalHandler(async () => ({ approved: false, reason: 'Not safe' }));
    await engine.authorize('agent-a', 'file_write', { path: 'x' }, undefined, SESSION);
    const records = await log.list(SESSION);
    expect(records).toHaveLength(1);
    expect(records[0].decision).toBe('rejected');
    expect(records[0].reason).toBe('Not safe');
  });

  it('records durationMs >= 0', async () => {
    await engine.authorize('agent-a', 'file_read', {}, undefined, SESSION);
    const records = await log.list(SESSION);
    expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('does not log when no sessionId is provided', async () => {
    // sessionId defaults to '' which is falsy — no record written
    await engine.authorize('agent-a', 'file_read', {});
    const records = await log.list('');
    expect(records).toHaveLength(0);
  });

  it('does not throw when approvalLog is absent', async () => {
    const noLogEngine = new AuthEngine();
    // file_read is auto by default — no write to disk, no exception
    const result = await noLogEngine.authorize('agent-a', 'file_read', {}, undefined, SESSION);
    expect(result).toEqual({ authorized: true });
  });

  it('accumulates multiple records across calls', async () => {
    await engine.authorize('agent-a', 'file_read', {}, undefined, SESSION);
    await engine.authorize('agent-a', 'file_read', {}, undefined, SESSION);
    await engine.authorize('agent-a', 'communicate', {}, undefined, SESSION);
    const records = await log.list(SESSION);
    expect(records).toHaveLength(3);
  });

  it('setApprovalLog() attaches a log after construction', async () => {
    const engineLate = new AuthEngine();
    engineLate.setApprovalLog(log);
    await engineLate.authorize('agent-x', 'file_read', {}, undefined, SESSION);
    const records = await log.list(SESSION);
    expect(records).toHaveLength(1);
  });
});
