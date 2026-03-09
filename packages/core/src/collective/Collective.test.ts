import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Storage } from '../workspace/Storage.js';
import { Collective } from './Collective.js';

describe('Collective', () => {
  let tmpDir: string;
  let storage: Storage;
  let collective: Collective;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'legion-collective-test-'));
    storage = new Storage(tmpDir);
    collective = new Collective(storage);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('getFromDisk', () => {
    it('reads a participant from disk bypassing cache', async () => {
      // Write directly to disk (not through collective.save)
      await storage.writeJSON('collective/participants/test-agent.json', {
        id: 'test-agent',
        name: 'Test Agent',
        type: 'agent',
        status: 'active',
        description: 'A test agent',
        systemPrompt: 'test',
        model: { provider: 'anthropic', model: 'test' },
        tools: {},
        approvalAuthority: {},
        createdBy: 'system',
        createdAt: '2026-01-01T00:00:00Z',
      });

      // Cache is empty, get() returns undefined
      expect(collective.get('test-agent')).toBeUndefined();

      // getFromDisk reads from disk
      const result = await collective.getFromDisk('test-agent');
      expect(result).toBeDefined();
      expect(result!.id).toBe('test-agent');
      expect(result!.name).toBe('Test Agent');

      // Also updates cache
      expect(collective.get('test-agent')).toBeDefined();
    });

    it('returns undefined for non-existent participant', async () => {
      const result = await collective.getFromDisk('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('listFromDisk', () => {
    it('lists all participants from disk', async () => {
      // Write two agents directly to disk
      await storage.writeJSON('collective/participants/agent-1.json', {
        id: 'agent-1',
        name: 'Agent 1',
        type: 'agent',
        status: 'active',
        description: 'First agent',
        systemPrompt: 'test',
        model: { provider: 'anthropic', model: 'test' },
        tools: {},
        approvalAuthority: {},
        createdBy: 'system',
        createdAt: '2026-01-01T00:00:00Z',
      });
      await storage.writeJSON('collective/participants/agent-2.json', {
        id: 'agent-2',
        name: 'Agent 2',
        type: 'agent',
        status: 'retired',
        description: 'Second agent',
        systemPrompt: 'test',
        model: { provider: 'anthropic', model: 'test' },
        tools: {},
        approvalAuthority: {},
        createdBy: 'system',
        createdAt: '2026-01-01T00:00:00Z',
      });

      // Cache is empty
      expect(collective.list()).toHaveLength(0);

      // listFromDisk reads from disk
      const all = await collective.listFromDisk();
      expect(all).toHaveLength(2);

      // With filter
      const active = await collective.listFromDisk({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('agent-1');
    });
  });

  describe('refresh', () => {
    it('refreshes cache from disk reflecting external changes', async () => {
      // Save an agent through the collective
      await collective.save({
        id: 'agent-x',
        name: 'Original',
        type: 'agent',
        status: 'active',
        description: 'An agent',
        systemPrompt: 'test',
        model: { provider: 'anthropic', model: 'test' },
        tools: {},
        approvalAuthority: {},
        createdBy: 'system',
        createdAt: '2026-01-01T00:00:00Z',
      });
      expect(collective.get('agent-x')!.name).toBe('Original');

      // External change to disk
      await storage.writeJSON('collective/participants/agent-x.json', {
        id: 'agent-x',
        name: 'Updated',
        type: 'agent',
        status: 'active',
        description: 'An agent',
        systemPrompt: 'test',
        model: { provider: 'anthropic', model: 'test' },
        tools: {},
        approvalAuthority: {},
        createdBy: 'system',
        createdAt: '2026-01-01T00:00:00Z',
      });

      // Cache still shows old value
      expect(collective.get('agent-x')!.name).toBe('Original');

      // After refresh, cache shows new value
      await collective.refresh();
      expect(collective.get('agent-x')!.name).toBe('Updated');
    });
  });

  describe('existing sync methods still work', () => {
    it('get/has/list work from cache after loadFromArray', () => {
      collective.loadFromArray([
        {
          id: 'mock-user',
          type: 'mock',
          name: 'Mock User',
          description: 'test',
          tools: {},
          approvalAuthority: {},
          status: 'active',
          responses: [{ trigger: '*', response: 'ok' }],
        } as any,
      ]);

      expect(collective.get('mock-user')).toBeDefined();
      expect(collective.has('mock-user')).toBe(true);
      expect(collective.list()).toHaveLength(1);
    });
  });
});
