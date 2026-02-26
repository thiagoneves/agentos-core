import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { generateContinueHere, consumeContinueHere, deleteContinueHere } from '../../../src/core/session-continuity.js';
import { SessionState, WorkflowDefinition } from '../../../src/types/index.js';

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'sess-1',
    workflowId: 'wf-1',
    activeMission: 'Build Feature X',
    currentAgent: 'dev',
    currentPhase: 'implement',
    status: 'paused',
    startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    promptCount: 3,
    contextBracket: 'MODERATE',
    tokens: 5000,
    costUsd: 0.05,
    events: [],
    ...overrides,
  };
}

function makeWorkflow(): WorkflowDefinition {
  return {
    workflow: { id: 'wf-1', name: 'Build Feature X' },
    phases: [
      { id: 'plan', name: 'Planning', agent: 'architect', task: 'create-plan', retry: 0 },
      { id: 'implement', name: 'Implementation', agent: 'dev', task: 'implement-feature', retry: 0 },
      { id: 'review', name: 'Code Review', agent: 'reviewer', task: 'review-code', retry: 0 },
    ],
  };
}

describe('SessionContinuity', () => {
  let tempDir: string;
  let agentosDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-cont-test-'));
    agentosDir = path.join(tempDir, '.agentos');
    await fs.mkdir(path.join(agentosDir, 'state'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'compiled'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('generateContinueHere', () => {
    it('should create a handoff markdown file', async () => {
      const session = makeSession();
      const workflow = makeWorkflow();

      const filePath = await generateContinueHere(session, workflow, agentosDir, 'paused');

      expect(filePath).toContain('.handoff.md');
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('session_id: sess-1');
      expect(content).toContain('Build Feature X');
      expect(content).toContain('paused');
    });

    it('should include completed phases as checked items', async () => {
      const session = makeSession({
        events: [
          {
            timestamp: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
            type: 'PHASE_START',
            agent: 'architect',
            phase: 'plan',
          },
          {
            timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
            type: 'PHASE_COMPLETE',
            agent: 'architect',
            phase: 'plan',
            data: { status: 'completed' },
          },
        ],
      });
      const workflow = makeWorkflow();

      const filePath = await generateContinueHere(session, workflow, agentosDir);
      const content = await fs.readFile(filePath, 'utf8');

      expect(content).toContain('[x] plan');
      expect(content).toContain('[ ] Code Review');
    });

    it('should include remaining phases as unchecked items', async () => {
      const session = makeSession({ events: [] });
      const workflow = makeWorkflow();

      const filePath = await generateContinueHere(session, workflow, agentosDir);
      const content = await fs.readFile(filePath, 'utf8');

      expect(content).toContain('[ ] Planning');
      expect(content).toContain('[ ] Implementation');
      expect(content).toContain('[ ] Code Review');
    });

    it('should include metrics', async () => {
      const session = makeSession({ tokens: 12345, costUsd: 0.1234 });
      const workflow = makeWorkflow();

      const filePath = await generateContinueHere(session, workflow, agentosDir);
      const content = await fs.readFile(filePath, 'utf8');

      expect(content).toContain('Tokens: 12345');
      expect(content).toContain('$0.1234');
    });

    it('should reference last compiled prompt', async () => {
      // Create a fake compiled prompt
      await fs.writeFile(
        path.join(agentosDir, 'compiled', 'build-2026-01-01.prompt.md'),
        'prompt content'
      );

      const session = makeSession();
      const workflow = makeWorkflow();

      const filePath = await generateContinueHere(session, workflow, agentosDir);
      const content = await fs.readFile(filePath, 'utf8');

      expect(content).toContain('.agentos/compiled/');
    });
  });

  describe('consumeContinueHere', () => {
    it('should return null when no handoff file exists', async () => {
      const result = await consumeContinueHere(agentosDir);
      expect(result).toBeNull();
    });

    it('should return content when handoff file exists', async () => {
      await fs.writeFile(
        path.join(agentosDir, 'state', '.handoff.md'),
        '# Handoff content'
      );

      const result = await consumeContinueHere(agentosDir);
      expect(result).toContain('Handoff content');
    });
  });

  describe('deleteContinueHere', () => {
    it('should delete the handoff file', async () => {
      const handoffPath = path.join(agentosDir, 'state', '.handoff.md');
      await fs.writeFile(handoffPath, 'content');

      await deleteContinueHere(agentosDir);

      const exists = await fs.access(handoffPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should not throw when file does not exist', async () => {
      await expect(deleteContinueHere(agentosDir)).resolves.toBeUndefined();
    });
  });
});
