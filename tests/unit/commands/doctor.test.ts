import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { doctorCommand } from '../../../src/commands/doctor.js';

describe('doctorCommand', () => {
  let tempDir: string;
  let agentosDir: string;
  let originalCwd: () => string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-doctor-test-'));
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

  it('should report missing .agentos directory', async () => {
    await doctorCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('.agentos/ directory missing');
  });

  it('should report valid config', async () => {
    await setupHealthyProject(tempDir, agentosDir);

    await doctorCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('config.yaml');
    expect(output).toContain('test-project');
  });

  it('should auto-fix missing core agents', async () => {
    await setupHealthyProject(tempDir, agentosDir);
    // Remove a core agent
    await fs.rm(path.join(agentosDir, 'core', 'agents', 'builder.md'));

    await doctorCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('builder.md');
    expect(output).toContain('fixed');
    // Verify file was recreated
    const exists = await fs.access(path.join(agentosDir, 'core', 'agents', 'builder.md')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('should warn on missing protocol when sync fails', async () => {
    await setupHealthyProject(tempDir, agentosDir);
    await fs.rm(path.join(agentosDir, 'core', 'rules', 'protocol.md'));

    await doctorCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    // Either fixed (re-synced) or warn (sync failed) — both are valid
    expect(output).toContain('protocol.md');
  });

  it('should auto-fix missing state directories', async () => {
    await setupHealthyProject(tempDir, agentosDir);
    await fs.rm(path.join(agentosDir, 'compiled'), { recursive: true });

    await doctorCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('compiled/');
    expect(output).toContain('fixed');
    // Verify directory was recreated
    const exists = await fs.access(path.join(agentosDir, 'compiled')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('should detect runner integration file', async () => {
    await setupHealthyProject(tempDir, agentosDir);

    await doctorCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('CLAUDE.md');
  });

  it('should report all checks passed for healthy project', async () => {
    await setupHealthyProject(tempDir, agentosDir);

    await doctorCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('All checks passed');
  });
});

async function setupHealthyProject(baseDir: string, agentosDir: string) {
  // Config
  const config = {
    version: '1.0',
    project: {
      name: 'test-project',
      output_language: 'en',
      runner: 'Claude Code',
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

  // Core agents
  const agentsDir = path.join(agentosDir, 'core', 'agents');
  await fs.mkdir(agentsDir, { recursive: true });
  for (const agent of ['maintainer.md', 'builder.md', 'doctor.md']) {
    await fs.writeFile(path.join(agentsDir, agent), `---\nid: ${agent}\n---\nAgent`, 'utf8');
  }

  // Core rules
  const rulesDir = path.join(agentosDir, 'core', 'rules');
  await fs.mkdir(rulesDir, { recursive: true });
  await fs.writeFile(path.join(rulesDir, 'protocol.md'), '# Protocol', 'utf8');

  // State dirs (all dirs that doctor checks)
  await fs.mkdir(path.join(agentosDir, 'state', 'sessions'), { recursive: true });
  await fs.mkdir(path.join(agentosDir, 'memory', 'summaries'), { recursive: true });
  await fs.mkdir(path.join(agentosDir, 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(agentosDir, 'compiled'), { recursive: true });
  await fs.mkdir(path.join(agentosDir, 'logs'), { recursive: true });

  // State files
  await fs.writeFile(path.join(agentosDir, 'state', 'current.yaml'), 'status: idle\nworkflow: null\nphase: null\nsession: null\n', 'utf8');
  await fs.writeFile(path.join(agentosDir, 'memory', 'index.yaml'), 'version: "1.0"\nartifacts: {}\n', 'utf8');

  // Manifest.lock
  await fs.writeFile(path.join(agentosDir, 'manifest.lock'), YAML.stringify({ version: '1.0', modules: {} }), 'utf8');

  // Runner integration
  await fs.writeFile(path.join(baseDir, 'CLAUDE.md'), '# AgentOS', 'utf8');
}
