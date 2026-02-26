import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { hooks } from '../../../src/core/hooks.js';
import { DashboardManager } from '../../../src/core/dashboard.js';

describe('Hooks & Dashboard Integration', () => {
  let tempDir: string;
  let dashboard: DashboardManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-hooks-test-'));
    // Pass tempDir to manager
    dashboard = new DashboardManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create a session file when session:start is emitted', async () => {
    const sessionId = 'test-session-123';

    hooks.emit('session:start', {
      sessionId,
      data: { workflowId: 'test-wf', activeMission: 'Test Mission' }
    });

    // Give some time for async IO
    await new Promise(resolve => setTimeout(resolve, 200));

    const sessionFile = path.join(tempDir, '.agentos', 'state', 'sessions', `${sessionId}.json`);
    const exists = await fs.access(sessionFile).then(() => true).catch(() => false);

    expect(exists).toBe(true);
    const content = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
    expect(content.activeMission).toBe('Test Mission');
  });

  it('should update session on step:start', async () => {
    const sessionId = 'test-step-start';

    // First create the session
    hooks.emit('session:start', {
      sessionId,
      data: { workflowId: 'wf', activeMission: 'Test' },
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    // Emit step start
    hooks.emit('step:start', {
      sessionId,
      agent: 'developer',
      data: { stepName: 'Implementation' },
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    const sessionFile = path.join(tempDir, '.agentos', 'state', 'sessions', `${sessionId}.json`);
    const content = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
    expect(content.currentAgent).toBe('developer');
    expect(content.currentPhase).toBe('Implementation');
  });

  it('should accumulate tokens on step:complete', async () => {
    const sessionId = 'test-step-complete';

    hooks.emit('session:start', {
      sessionId,
      data: { workflowId: 'wf', activeMission: 'Test' },
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    hooks.emit('step:complete', {
      sessionId,
      agent: 'dev',
      data: { stepName: 'Build', tokens: 5000, cost: 0.05 },
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    const sessionFile = path.join(tempDir, '.agentos', 'state', 'sessions', `${sessionId}.json`);
    const content = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
    expect(content.tokens).toBe(5000);
    expect(content.costUsd).toBe(0.05);
  });

  it('should update status on metrics:update', async () => {
    const sessionId = 'test-metrics-update';

    hooks.emit('session:start', {
      sessionId,
      data: { workflowId: 'wf', activeMission: 'Test' },
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    hooks.emit('metrics:update', {
      sessionId,
      data: { currentPhase: 'Review', status: 'completed', tokens: 1000, cost: 0.01 },
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    const sessionFile = path.join(tempDir, '.agentos', 'state', 'sessions', `${sessionId}.json`);
    const content = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
    expect(content.currentPhase).toBe('Review');
    expect(content.status).toBe('completed');
  });

  it('should update global metrics on step:complete', async () => {
    const sessionId = 'test-global-metrics';

    hooks.emit('session:start', {
      sessionId,
      data: { workflowId: 'wf', activeMission: 'Test' },
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    hooks.emit('step:complete', {
      sessionId,
      agent: 'dev',
      data: { tokens: 3000, cost: 0.03 },
    });
    await new Promise(resolve => setTimeout(resolve, 300));

    const metricsPath = path.join(tempDir, '.agentos', 'state', 'global-metrics.json');
    const exists = await fs.access(metricsPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const metrics = JSON.parse(await fs.readFile(metricsPath, 'utf8'));
    expect(metrics.total_tokens).toBeGreaterThanOrEqual(3000);
    expect(metrics.total_cost_usd).toBeGreaterThanOrEqual(0.03);
  });

  it('should append events to session', async () => {
    const sessionId = 'test-events';

    hooks.emit('session:start', {
      sessionId,
      data: { workflowId: 'wf', activeMission: 'Test' },
    });
    await new Promise(resolve => setTimeout(resolve, 150));

    hooks.emit('step:start', {
      sessionId,
      agent: 'dev',
      data: { stepName: 'Build' },
    });
    await new Promise(resolve => setTimeout(resolve, 150));

    hooks.emit('step:complete', {
      sessionId,
      agent: 'dev',
      data: { stepName: 'Build', tokens: 100, cost: 0.001 },
    });
    await new Promise(resolve => setTimeout(resolve, 150));

    const sessionFile = path.join(tempDir, '.agentos', 'state', 'sessions', `${sessionId}.json`);
    const content = JSON.parse(await fs.readFile(sessionFile, 'utf8'));

    expect(content.events.length).toBeGreaterThanOrEqual(3);
    const types = content.events.map((e: any) => e.type);
    expect(types).toContain('SESSION_START');
    expect(types).toContain('STEP_START');
    expect(types).toContain('STEP_COMPLETE');
  });
});
