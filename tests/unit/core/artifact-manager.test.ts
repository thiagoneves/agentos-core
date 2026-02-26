import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ArtifactManager } from '../../../src/core/artifact-manager.js';

describe('ArtifactManager', () => {
  let tempDir: string;
  let manager: ArtifactManager;
  let artifactsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-artifacts-test-'));
    manager = new ArtifactManager(tempDir);
    artifactsDir = path.join(tempDir, '.agentos', 'artifacts');
    await fs.mkdir(artifactsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should sync and index artifacts correctly', async () => {
    await fs.writeFile(path.join(artifactsDir, '01-test.md'), '# Test Title\nContent here');

    await manager.syncIndex();

    const indexPath = path.join(tempDir, '.agentos', 'memory', 'index.yaml');
    const exists = await fs.access(indexPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const indexContent = await manager.getIndexContent();
    expect(indexContent).toContain('01-test.md');
    expect(indexContent).toContain('Test Title');
  });

  it('should index multiple artifacts', async () => {
    await fs.writeFile(path.join(artifactsDir, '01-story.md'), '# Story\nOnce upon a time.');
    await fs.writeFile(path.join(artifactsDir, '02-plan.md'), '# Architecture Plan\nBuild it.');

    await manager.syncIndex();
    const content = await manager.getIndexContent();

    expect(content).toContain('01-story.md');
    expect(content).toContain('02-plan.md');
    expect(content).toContain('Story');
    expect(content).toContain('Architecture Plan');
  });

  it('should skip non-markdown files', async () => {
    await fs.writeFile(path.join(artifactsDir, 'data.json'), '{}');
    await fs.writeFile(path.join(artifactsDir, '01-test.md'), '# Test');

    await manager.syncIndex();
    const content = await manager.getIndexContent();

    expect(content).toContain('01-test.md');
    expect(content).not.toContain('data.json');
  });

  it('should cache index when files have not changed', async () => {
    await fs.writeFile(path.join(artifactsDir, '01-test.md'), '# Cached');

    await manager.syncIndex();
    const first = await manager.getIndexContent();

    // Second sync should use cache (same content returned)
    await manager.syncIndex();
    const second = await manager.getIndexContent();

    expect(first).toBe(second);
  });

  it('should re-index when files change', async () => {
    await fs.writeFile(path.join(artifactsDir, '01-test.md'), '# Original');
    await manager.syncIndex();

    // Modify the file (ensure different mtime)
    await new Promise(r => setTimeout(r, 10));
    await fs.writeFile(path.join(artifactsDir, '01-test.md'), '# Updated');
    await manager.syncIndex();

    const content = await manager.getIndexContent();
    expect(content).toContain('Updated');
  });

  it('should return fallback message when no index exists', async () => {
    const content = await manager.getIndexContent();
    expect(content).toContain('No artifact index found');
  });

  it('should handle empty artifacts directory gracefully', async () => {
    await manager.syncIndex();
    const content = await manager.getIndexContent();
    // No .md files → syncIndex skips (mtime hash matches empty), index file not created
    expect(content).toContain('No artifact index found');
  });

  it('should include file size in index', async () => {
    await fs.writeFile(path.join(artifactsDir, '01-test.md'), '# Test\n'.repeat(100));
    await manager.syncIndex();
    const content = await manager.getIndexContent();
    expect(content).toContain('size');
  });
});
