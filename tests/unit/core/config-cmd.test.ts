import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigManager } from '../../../src/core/config.js';

// Test the underlying config get/set logic (not the CLI wrapper)
describe('Config get/set', () => {
  let tempDir: string;
  let manager: ConfigManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-configcmd-test-'));
    manager = new ConfigManager(tempDir);
    await manager.init({
      project: { name: 'test-app', state: 'brownfield', output_language: 'English', runner: 'Auto-detect', profile: 'solo' },
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should read nested config values', async () => {
    const config = await manager.load();
    expect(config.project.name).toBe('test-app');
    expect(config.settings.tokens.context_budget).toBe('50%');
    expect(config.settings.session.crash_detection_minutes).toBe(30);
  });

  it('should update config with partial patch', async () => {
    const updated = await manager.update({
      project: { name: 'new-name', state: 'brownfield', output_language: 'Portuguese', runner: 'Claude Code', profile: 'team' },
    });
    expect(updated.project.name).toBe('new-name');
    expect(updated.project.output_language).toBe('Portuguese');

    // Other settings should persist
    expect(updated.settings.tokens.context_budget).toBe('50%');
  });

  it('should update settings deeply', async () => {
    const updated = await manager.update({
      settings: {
        tokens: { context_budget: '70%', summary_max_lines: 100, index_enabled: false },
        git: { auto_commit: false, commit_prefix: 'feat' },
      },
    } as any);
    expect(updated.settings.tokens.context_budget).toBe('70%');
    expect(updated.settings.git.auto_commit).toBe(false);
  });
});
