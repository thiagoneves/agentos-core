import { describe, it, expect } from 'vitest';
import { detectCrashedSession, cleanStaleSessions, generateSessionTitle } from '../../../src/core/session-manager.js';
import { SessionState } from '../../../src/types/index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'test-sess',
    workflowId: 'wf-1',
    activeMission: 'Test',
    currentAgent: 'dev',
    currentPhase: 'build',
    status: 'running',
    startedAt: new Date().toISOString(),
    promptCount: 0,
    contextBracket: 'FRESH',
    tokens: 0,
    costUsd: 0,
    events: [],
    ...overrides,
  };
}

describe('SessionManager', () => {
  describe('generateSessionTitle', () => {
    it('should generate a title from mission name', () => {
      const title = generateSessionTitle('Feature X', 'Planning');
      expect(title).toContain('Feature X');
    });

    it('should handle missing phase', () => {
      const title = generateSessionTitle('Feature X');
      expect(title).toBe('Feature X');
    });

    it('should append phase when mission is short', () => {
      const title = generateSessionTitle('Fix', 'Build');
      expect(title).toBe('Fix: Build');
    });

    it('should truncate long titles', () => {
      const longName = 'A'.repeat(60);
      const title = generateSessionTitle(longName);
      expect(title.length).toBeLessThanOrEqual(50);
      expect(title).toContain('...');
    });
  });

  describe('detectCrashedSession', () => {
    it('should return null for completed sessions', () => {
      const session = makeSession({ status: 'completed' });
      expect(detectCrashedSession(session)).toBeNull();
    });

    it('should return null for paused sessions', () => {
      const session = makeSession({ status: 'paused' });
      expect(detectCrashedSession(session)).toBeNull();
    });

    it('should return null for recently active running sessions', () => {
      const session = makeSession({ lastActivity: new Date().toISOString() });
      expect(detectCrashedSession(session, 30)).toBeNull();
    });

    it('should detect a stale running session', () => {
      const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60 min ago
      const session = makeSession({ lastActivity: oldTime });
      const result = detectCrashedSession(session, 30);
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe('test-sess');
      expect(result!.minutesSinceActivity).toBeGreaterThanOrEqual(59);
    });

    it('should use startedAt if lastActivity is missing', () => {
      const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const session = makeSession({ startedAt: oldTime, lastActivity: undefined });
      const result = detectCrashedSession(session, 30);
      expect(result).not.toBeNull();
    });
  });

  describe('cleanStaleSessions', () => {
    it('should handle non-existent directory', async () => {
      const cleaned = await cleanStaleSessions('/tmp/does-not-exist-' + Date.now());
      expect(cleaned).toBe(0);
    });

    it('should clean old completed sessions', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-clean-test-'));
      const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago

      await fs.writeFile(
        path.join(tempDir, 'old-sess.json'),
        JSON.stringify({
          sessionId: 'old-sess',
          workflowId: 'wf',
          activeMission: 'test',
          currentAgent: 'dev',
          currentPhase: 'build',
          status: 'completed',
          startedAt: oldTime,
          lastActivity: oldTime,
          events: [],
        })
      );

      const cleaned = await cleanStaleSessions(tempDir, 168); // 7 days
      expect(cleaned).toBe(1);
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should not clean running sessions regardless of age', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-clean-test-'));
      const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

      await fs.writeFile(
        path.join(tempDir, 'running-sess.json'),
        JSON.stringify({
          sessionId: 'running-sess',
          workflowId: 'wf',
          activeMission: 'test',
          currentAgent: 'dev',
          currentPhase: 'build',
          status: 'running',
          startedAt: oldTime,
          lastActivity: oldTime,
          events: [],
        })
      );

      const cleaned = await cleanStaleSessions(tempDir, 168);
      expect(cleaned).toBe(0);
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should handle empty directory', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-clean-test-'));
      const cleaned = await cleanStaleSessions(tempDir);
      expect(cleaned).toBe(0);
      await fs.rm(tempDir, { recursive: true, force: true });
    });
  });
});
