import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { syncCommand } from '../../../src/commands/sync.js';

describe('syncCommand', () => {
  let tempDir: string;
  let agentosDir: string;
  let originalCwd: () => string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-sync-test-'));
    agentosDir = path.join(tempDir, '.agentos');
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should generate CLAUDE.md for Claude Code runner', async () => {
    await setupConfig(agentosDir, 'Claude Code');

    await syncCommand();

    const claudeMd = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('AgentOS');
    expect(claudeMd).toContain('Claude Code');
  });

  it('should generate protocol file', async () => {
    await setupConfig(agentosDir, 'Claude Code');

    await syncCommand();

    const protocol = await fs.readFile(
      path.join(agentosDir, 'core', 'rules', 'protocol.md'),
      'utf8'
    );
    expect(protocol).toContain('AgentOS Protocol');
  });

  it('should generate GEMINI.md for Gemini runner', async () => {
    await setupConfig(agentosDir, 'Gemini CLI');

    await syncCommand();

    const geminiMd = await fs.readFile(path.join(tempDir, 'GEMINI.md'), 'utf8');
    expect(geminiMd).toContain('Gemini CLI');
  });

  it('should generate .cursorrules for Cursor runner', async () => {
    await setupConfig(agentosDir, 'Cursor');

    await syncCommand();

    const cursorRules = await fs.readFile(path.join(tempDir, '.cursorrules'), 'utf8');
    expect(cursorRules).toContain('AgentOS Protocol');
  });

  it('should log sync complete on success', async () => {
    await setupConfig(agentosDir, 'Claude Code');

    await syncCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Sync complete');
  });

  it('should report error when config is missing', async () => {
    // No config file
    await syncCommand();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Sync failed')
    );
  });
});

async function setupConfig(agentosDir: string, runner: string) {
  const config = {
    version: '1.0',
    project: {
      name: 'test-project',
      output_language: 'en',
      runner,
      profile: 'solo',
      state: 'greenfield',
    },
    engineering: { stack: ['TypeScript'] },
    modules: { installed: [] },
    settings: {
      git: { auto_commit: false, commit_prefix: 'aos' },
      tokens: { context_budget: '50%', summary_max_lines: 50, index_enabled: true },
      session: { crash_detection_minutes: 30, max_events: 200 },
    },
  };
  await fs.mkdir(agentosDir, { recursive: true });
  await fs.writeFile(path.join(agentosDir, 'config.yaml'), YAML.stringify(config), 'utf8');
}
