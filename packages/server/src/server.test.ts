import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '@legion-collective/core';
import { LegionServer } from './server.js';

describe('LegionServer', () => {
  let workspace: Workspace;
  let server: LegionServer;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'legion-server-test-'));
    workspace = new Workspace(tempDir);
    await workspace.initialize();
  });

  afterEach(async () => {
    try {
      await server?.stop();
    } catch {
      // server may not have started
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should start and stop cleanly', async () => {
    server = new LegionServer({ workspace, port: 0 });
    await server.start();
    expect(server.session).not.toBeNull();
    await server.stop();
  });

  it('should create a default session on start', async () => {
    server = new LegionServer({ workspace, port: 0 });
    await server.start();
    const session = server.session;
    expect(session).not.toBeNull();
    expect(session!.data.status).toBe('active');
  });
});

describe('LegionServer REST API', () => {
  let workspace: Workspace;
  let server: LegionServer;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'legion-api-test-'));
    workspace = new Workspace(tempDir);
    await workspace.initialize();
    server = new LegionServer({ workspace, port: 0 });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('GET /api/collective/participants', () => {
    it('should return the default participants', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/collective/participants',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(3); // user, ur-agent, resource-agent
    });

    it('should filter by type', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/collective/participants?type=agent',
      });
      const body = response.json();
      expect(body.every((p: { type: string }) => p.type === 'agent')).toBe(true);
    });
  });

  describe('GET /api/collective/participants/:id', () => {
    it('should return a specific participant', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/collective/participants/ur-agent',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe('ur-agent');
    });

    it('should return 404 for unknown participant', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/collective/participants/nonexistent',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/sessions', () => {
    it('should list sessions', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/sessions',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('should return the active session', async () => {
      const sessionId = server.session!.data.id;
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(sessionId);
    });
  });

  describe('POST /api/sessions', () => {
    it('should create a new session and make it active', async () => {
      const originalId = server.session!.data.id;
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { name: 'Test Session' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('Test Session');
      expect(body.id).not.toBe(originalId);
      // Should now be the active session
      expect(server.session!.data.id).toBe(body.id);
    });
  });

  describe('POST /api/sessions/:id/activate', () => {
    it('should activate the current session (no-op)', async () => {
      const sessionId = server.session!.data.id;
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/activate`,
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(sessionId);
    });

    it('should switch to a different session', async () => {
      // Create a second session
      const createRes = await server.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { name: 'Second Session' },
      });
      const secondId = createRes.json().id;

      // Create a third session (this becomes active)
      await server.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { name: 'Third Session' },
      });

      // Now activate the second session
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/sessions/${secondId}/activate`,
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(secondId);
      expect(server.session!.data.id).toBe(secondId);
    });

    it('should return 404 for unknown session', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/sessions/nonexistent-session-id/activate',
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/processes', () => {
    it('should return empty process list', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/processes',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });
  });

  describe('GET /api/config', () => {
    it('should return workspace config', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/config',
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/files/tree', () => {
    it('should return directory tree', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/files/tree',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe('GET /api/approvals/pending', () => {
    it('should return empty pending list', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/approvals/pending',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });
  });

  describe('GET /api/tools', () => {
    it('should return list of registered tools', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/tools',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      expect(body[0]).toHaveProperty('name');
      expect(body[0]).toHaveProperty('description');
      expect(body[0]).toHaveProperty('parameters');
    });

    it('should include well-known tools', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/tools',
      });
      const body = response.json() as { name: string }[];
      const names = body.map((t) => t.name);
      expect(names).toContain('list_tools');
      expect(names).toContain('list_models');
      expect(names).toContain('communicate');
      expect(names).toContain('file_read');
    });
  });

  describe('POST /api/tools/:name/execute', () => {
    it('should execute list_tools and return tool list', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/tools/list_tools/execute',
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('success');
      expect(body.data).toBeDefined();
      const data = JSON.parse(body.data as string);
      expect(data.count).toBeGreaterThan(0);
      expect(data.tools.length).toBeGreaterThan(0);
    });

    it('should return 404 for unknown tool', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/tools/nonexistent_tool/execute',
        payload: {},
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toHaveProperty('error');
    });

    it('should pass arguments to tool', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/tools/list_tools/execute',
        payload: { verbose: true },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const data = JSON.parse(body.data as string);
      // Verbose mode includes parameters
      expect(data.tools[0]).toHaveProperty('parameters');
    });
  });
});
