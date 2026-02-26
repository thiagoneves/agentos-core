import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Summarizer } from '../../../src/core/summarizer.js';
import { SessionMetrics } from '../../../src/core/dashboard.js';

describe('Summarizer', () => {
  let tempDir: string;
  let summarizer: Summarizer;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-summarizer-test-'));
    summarizer = new Summarizer(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should generate a markdown summary from session events', async () => {
    const session: SessionMetrics = {
      sessionId: 'test-session',
      workflowId: 'sdc',
      activeMission: 'Feature Test',
      currentAgent: 'dev',
      currentPhase: 'Implementation',
      status: 'running',
      tokens: 1000,
      costUsd: 0.01,
      events: [
        {
          timestamp: new Date().toISOString(),
          type: 'STEP_COMPLETE',
          agent: 'pm',
          data: { stepName: 'Discovery', artifact: 'artifacts/01-story.md' }
        }
      ]
    };

    const summary = await summarizer.summarizeSession(session);

    expect(summary).toContain('Feature Test');
    expect(summary).toContain('**pm** completed phase **Discovery**');
    expect(summary).toContain('`artifacts/01-story.md`');

    const latest = await summarizer.getLatestSummary('test-session');
    expect(latest).toBe(summary);
  });

  it('should return message for empty events', async () => {
    const session: SessionMetrics = {
      sessionId: 'empty-session',
      workflowId: 'sdc',
      activeMission: 'Empty',
      currentAgent: 'dev',
      currentPhase: 'Starting',
      status: 'running',
      tokens: 0,
      costUsd: 0,
      events: []
    };

    const summary = await summarizer.summarizeSession(session);
    expect(summary).toContain('No previous activity');
  });

  it('should return null for non-existent summary', async () => {
    const result = await summarizer.getLatestSummary('nonexistent');
    expect(result).toBeNull();
  });

  it('should include current state in summary', async () => {
    const session: SessionMetrics = {
      sessionId: 'state-session',
      workflowId: 'wf',
      activeMission: 'Test',
      currentAgent: 'reviewer',
      currentPhase: 'Review',
      status: 'running',
      tokens: 500,
      costUsd: 0.005,
      events: [
        {
          timestamp: new Date().toISOString(),
          type: 'STEP_COMPLETE',
          agent: 'dev',
          data: { stepName: 'Build' }
        }
      ]
    };

    const summary = await summarizer.summarizeSession(session);
    expect(summary).toContain('Review');
    expect(summary).toContain('@reviewer');
  });

  it('should handle multiple completed steps', async () => {
    const session: SessionMetrics = {
      sessionId: 'multi-step',
      workflowId: 'wf',
      activeMission: 'Multi',
      currentAgent: 'dev',
      currentPhase: 'Done',
      status: 'completed',
      tokens: 10000,
      costUsd: 0.1,
      events: [
        { timestamp: new Date().toISOString(), type: 'STEP_COMPLETE', agent: 'pm', data: { stepName: 'Discovery' } },
        { timestamp: new Date().toISOString(), type: 'STEP_COMPLETE', agent: 'dev', data: { stepName: 'Build' } },
        { timestamp: new Date().toISOString(), type: 'STEP_COMPLETE', agent: 'qa', data: { stepName: 'Test' } },
      ]
    };

    const summary = await summarizer.summarizeSession(session);
    expect(summary).toContain('Discovery');
    expect(summary).toContain('Build');
    expect(summary).toContain('Test');
  });

  it('should persist summary to file', async () => {
    const session: SessionMetrics = {
      sessionId: 'persisted',
      workflowId: 'wf',
      activeMission: 'Persist',
      currentAgent: 'dev',
      currentPhase: 'Build',
      status: 'running',
      tokens: 100,
      costUsd: 0.001,
      events: [
        { timestamp: new Date().toISOString(), type: 'STEP_COMPLETE', agent: 'dev', data: { stepName: 'Init' } },
      ]
    };

    await summarizer.summarizeSession(session);

    const summaryPath = path.join(tempDir, '.agentos', 'memory', 'summaries', 'persisted.md');
    const exists = await fs.access(summaryPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
