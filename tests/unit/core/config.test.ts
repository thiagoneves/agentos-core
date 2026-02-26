import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigManager } from '../../../src/core/config.js';

describe('ConfigManager', () => {
  let tempDir: string;
  let manager: ConfigManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-config-test-'));
    manager = new ConfigManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should initialize a new config file', async () => {
    const config = await manager.init({
      project: { name: 'Test', state: 'greenfield', output_language: 'English', runner: 'Claude Code' },
    });

    expect(await manager.exists()).toBe(true);
    expect(config.project.name).toBe('Test');
    expect(config.project.state).toBe('greenfield');
    expect(config.version).toBe('1.0');
  });

  it('should detect if config exists', async () => {
    expect(await manager.exists()).toBe(false);
    await manager.init({});
    expect(await manager.exists()).toBe(true);
  });

  it('should load and validate config', async () => {
    await manager.init({ project: { name: 'LoadTest', state: 'brownfield', output_language: 'Portugues', runner: 'Auto-detect' } });
    const config = await manager.load();
    expect(config.project.name).toBe('LoadTest');
    expect(config.project.model_profile).toBe('balanced');
    expect(config.settings.tokens.context_budget).toBe('50%');
  });

  it('should update config with patch', async () => {
    await manager.init({ project: { name: 'Original', state: 'greenfield', output_language: 'English', runner: 'Auto-detect' } });
    const updated = await manager.update({ project: { name: 'Updated', state: 'greenfield', output_language: 'English', runner: 'Claude Code' } });
    expect(updated.project.name).toBe('Updated');
    expect(updated.project.runner).toBe('Claude Code');
  });
});
