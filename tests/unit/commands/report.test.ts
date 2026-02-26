import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { reportCommand } from '../../../src/commands/report.js';

describe('reportCommand', () => {
  let tempDir: string;
  let sessionsDir: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-report-test-'));
    sessionsDir = path.join(tempDir, '.agentos', 'state', 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create a new session file when none exists', async () => {
    await reportCommand({
      sessionId: 'test-session-1',
      step: 'Planning',
      status: 'running',
    });

    const sessionPath = path.join(sessionsDir, 'test-session-1.json');
    const content = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
    expect(content.sessionId).toBe('test-session-1');
    expect(content.currentPhase).toBe('Planning');
    expect(content.status).toBe('running');
    expect(content.events).toHaveLength(1);
    expect(content.events[0].type).toBe('METRICS_UPDATE');
  });

  it('should update an existing session with new metrics', async () => {
    const existing = {
      sessionId: 'sess-2',
      workflowId: 'wf-1',
      activeMission: 'Build feature',
      currentAgent: 'dev',
      currentPhase: 'Planning',
      status: 'running',
      tokens: 100,
      costUsd: 0.01,
      events: [],
    };
    await fs.writeFile(
      path.join(sessionsDir, 'sess-2.json'),
      JSON.stringify(existing),
      'utf8'
    );

    await reportCommand({
      sessionId: 'sess-2',
      step: 'Build',
      tokens: '500',
      cost: '0.05',
    });

    const updated = JSON.parse(
      await fs.readFile(path.join(sessionsDir, 'sess-2.json'), 'utf8')
    );
    expect(updated.tokens).toBe(600);
    expect(updated.costUsd).toBeCloseTo(0.06);
    expect(updated.currentPhase).toBe('Build');
    expect(updated.events).toHaveLength(1);
  });

  it('should mark event as STEP_COMPLETE when status is completed', async () => {
    await reportCommand({
      sessionId: 'sess-3',
      step: 'Done',
      status: 'completed',
    });

    const content = JSON.parse(
      await fs.readFile(path.join(sessionsDir, 'sess-3.json'), 'utf8')
    );
    expect(content.status).toBe('completed');
    expect(content.events[0].type).toBe('STEP_COMPLETE');
  });

  it('should update the agent when provided', async () => {
    await reportCommand({
      sessionId: 'sess-4',
      agent: 'architect',
      step: 'Design',
    });

    const content = JSON.parse(
      await fs.readFile(path.join(sessionsDir, 'sess-4.json'), 'utf8')
    );
    expect(content.currentAgent).toBe('architect');
    expect(content.events[0].agent).toBe('architect');
  });

  it('should find active session when sessionId not provided', async () => {
    const running = {
      sessionId: 'active-sess',
      status: 'running',
      tokens: 0,
      costUsd: 0,
      events: [],
      currentAgent: 'dev',
      currentPhase: 'Build',
    };
    await fs.writeFile(
      path.join(sessionsDir, 'active-sess.json'),
      JSON.stringify(running),
      'utf8'
    );

    await reportCommand({ step: 'Test', status: 'running' });

    const updated = JSON.parse(
      await fs.readFile(path.join(sessionsDir, 'active-sess.json'), 'utf8')
    );
    expect(updated.currentPhase).toBe('Test');
  });

  it('should log error when no session found and no sessionId', async () => {
    // Empty sessions dir, no sessionId
    await reportCommand({ step: 'Build' });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('No active session found')
    );
  });
});
