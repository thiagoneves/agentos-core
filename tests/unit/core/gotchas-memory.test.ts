import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { GotchasMemory } from '../../../src/core/gotchas-memory.js';

describe('GotchasMemory', () => {
  let tempDir: string;
  let gotchas: GotchasMemory;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-gotchas-test-'));
    gotchas = new GotchasMemory(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should return null for first occurrence of an error', async () => {
    const result = await gotchas.recordError('TypeError: x is undefined', 'dev', 'execution');
    expect(result).toBeNull();
  });

  it('should return null for second occurrence', async () => {
    await gotchas.recordError('TypeError: x is undefined', 'dev', 'execution');
    const result = await gotchas.recordError('TypeError: x is undefined', 'dev', 'execution');
    expect(result).toBeNull();
  });

  it('should promote to gotcha on third occurrence', async () => {
    await gotchas.recordError('TypeError: x is undefined', 'dev', 'execution');
    await gotchas.recordError('TypeError: x is undefined', 'dev', 'execution');
    const result = await gotchas.recordError('TypeError: x is undefined', 'dev', 'execution');
    expect(result).not.toBeNull();
    expect(result!.occurrences).toBe(3);
    expect(result!.agent).toBe('dev');
  });

  it('should normalize file paths to basenames', async () => {
    // These should be treated as the same error
    await gotchas.recordError('Error in /Users/foo/bar/src/app.ts', 'dev');
    await gotchas.recordError('Error in /home/ci/build/src/app.ts', 'dev');
    const result = await gotchas.recordError('Error in /var/tmp/src/app.ts', 'dev');
    // All normalize to "Error in app.ts" → should be a gotcha
    expect(result).not.toBeNull();
  });

  it('should increment occurrences for existing gotchas', async () => {
    // Create a gotcha first
    await gotchas.recordError('Recurring error', 'dev');
    await gotchas.recordError('Recurring error', 'dev');
    await gotchas.recordError('Recurring error', 'dev');

    // Fourth occurrence should still return the gotcha
    const result = await gotchas.recordError('Recurring error', 'dev');
    expect(result).not.toBeNull();
    expect(result!.occurrences).toBe(4);
  });

  it('should return relevant gotchas as formatted string', async () => {
    // Create a gotcha for 'dev' agent
    await gotchas.recordError('Build fails on import', 'dev', 'build');
    await gotchas.recordError('Build fails on import', 'dev', 'build');
    await gotchas.recordError('Build fails on import', 'dev', 'build');

    const hints = await gotchas.getRelevantGotchas('dev');
    expect(hints).toContain('Build fails on import');
    expect(hints).toContain('3x');
  });

  it('should return empty string when no gotchas exist', async () => {
    const hints = await gotchas.getRelevantGotchas('dev');
    expect(hints).toBe('');
  });

  it('should limit to 5 gotchas max', async () => {
    // Create 7 different gotchas
    for (let i = 0; i < 7; i++) {
      const msg = `Error type ${i}`;
      for (let j = 0; j < 3; j++) {
        await gotchas.recordError(msg, 'dev', 'general');
      }
    }

    const hints = await gotchas.getRelevantGotchas('dev', 'general');
    const lines = hints.split('\n').filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(5);
  });
});
