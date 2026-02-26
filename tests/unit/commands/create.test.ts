import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';

// Mock inquirer before importing commands
vi.mock('inquirer', () => ({
  default: { prompt: vi.fn() },
}));

import inquirer from 'inquirer';
import {
  createModuleCommand,
  createAgentCommand,
  createTaskCommand,
  createWorkflowCommand,
} from '../../../src/commands/create.js';

describe('create commands', () => {
  let tempDir: string;
  let agentosDir: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-create-test-'));
    agentosDir = path.join(tempDir, '.agentos');
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

  describe('createModuleCommand', () => {
    it('should create module directory structure', async () => {
      await setupProject(tempDir, agentosDir);
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({
        description: 'Test module',
        author: 'tester',
        domain: 'testing',
      });

      await createModuleCommand('my-mod');

      const moduleDir = path.join(agentosDir, 'modules', 'my-mod');
      // Check dirs exist
      for (const dir of ['agents', 'tasks', 'workflows', 'rules']) {
        const stat = await fs.stat(path.join(moduleDir, dir));
        expect(stat.isDirectory()).toBe(true);
      }
    });

    it('should create valid module.yaml', async () => {
      await setupProject(tempDir, agentosDir);
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({
        description: 'A cool module',
        author: 'dev',
        domain: 'devops',
      });

      await createModuleCommand('cool-mod');

      const content = await fs.readFile(
        path.join(agentosDir, 'modules', 'cool-mod', 'module.yaml'),
        'utf8',
      );
      const manifest = YAML.parse(content);
      expect(manifest.name).toBe('cool-mod');
      expect(manifest.version).toBe('0.1.0');
      expect(manifest.description).toBe('A cool module');
      expect(manifest.domain).toBe('devops');
    });

    it('should update config.yaml with new module', async () => {
      await setupProject(tempDir, agentosDir);
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({
        description: 'Test',
        author: '',
        domain: 'custom',
      });

      await createModuleCommand('new-mod');

      const configContent = await fs.readFile(path.join(agentosDir, 'config.yaml'), 'utf8');
      const config = YAML.parse(configContent);
      const found = config.modules.installed.find((m: { name: string }) => m.name === 'new-mod');
      expect(found).toBeDefined();
      expect(found.version).toBe('0.1.0');
    });

    it('should reject if module already exists', async () => {
      await setupProject(tempDir, agentosDir);
      await fs.mkdir(path.join(agentosDir, 'modules', 'existing'), { recursive: true });

      await createModuleCommand('existing');

      const output = (console.error as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ');
      expect(output).toContain('already exists');
    });

    it('should reject if not an AgentOS project', async () => {
      // No .agentos dir
      await createModuleCommand('test');

      const output = (console.error as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ');
      expect(output).toContain('Not an AgentOS project');
    });
  });

  describe('createAgentCommand', () => {
    it('should create agent markdown with correct frontmatter', async () => {
      await setupProject(tempDir, agentosDir);
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({
        title: 'Code Reviewer',
        domain: 'development',
        target: 'core',
      });

      await createAgentCommand('reviewer');

      const content = await fs.readFile(
        path.join(agentosDir, 'core', 'agents', 'reviewer.md'),
        'utf8',
      );
      expect(content).toContain('id: reviewer');
      expect(content).toContain('title: Code Reviewer');
      expect(content).toContain('domain: development');
      expect(content).toContain('# @reviewer');
      expect(content).toContain('## Role');
      expect(content).toContain('## Core Principles');
      expect(content).toContain('## Commands');
      expect(content).toContain('## Authority');
    });

    it('should create agent in module and update manifest', async () => {
      await setupProject(tempDir, agentosDir);
      await createModule(agentosDir, 'my-mod');

      vi.mocked(inquirer.prompt).mockResolvedValueOnce({
        title: 'Deploy Agent',
        domain: 'devops',
        target: 'my-mod',
      });

      await createAgentCommand('deployer');

      // File created
      const filePath = path.join(agentosDir, 'modules', 'my-mod', 'agents', 'deployer.md');
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('id: deployer');

      // Manifest updated
      const manifestContent = await fs.readFile(
        path.join(agentosDir, 'modules', 'my-mod', 'module.yaml'),
        'utf8',
      );
      const manifest = YAML.parse(manifestContent);
      expect(manifest.agents).toContain('agents/deployer.md');
    });

    it('should omit domain when empty', async () => {
      await setupProject(tempDir, agentosDir);
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({
        title: 'Simple Agent',
        domain: '',
        target: 'core',
      });

      await createAgentCommand('simple');

      const content = await fs.readFile(
        path.join(agentosDir, 'core', 'agents', 'simple.md'),
        'utf8',
      );
      expect(content).not.toContain('domain:');
    });
  });

  describe('createTaskCommand', () => {
    it('should create task markdown with correct frontmatter', async () => {
      await setupProject(tempDir, agentosDir);
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({
        displayName: 'Run Tests',
        agent: 'builder',
        target: 'core',
      });

      await createTaskCommand('run-tests');

      const content = await fs.readFile(
        path.join(agentosDir, 'core', 'tasks', 'run-tests.md'),
        'utf8',
      );
      expect(content).toContain('task: run-tests');
      expect(content).toContain('agent: builder');
      expect(content).toContain('# Run Tests');
      expect(content).toContain('## Purpose');
      expect(content).toContain('## Steps');
      expect(content).toContain('## Error Handling');
    });

    it('should create task in module and update manifest', async () => {
      await setupProject(tempDir, agentosDir);
      await createModule(agentosDir, 'my-mod');

      vi.mocked(inquirer.prompt).mockResolvedValueOnce({
        displayName: 'Deploy App',
        agent: 'deployer',
        target: 'my-mod',
      });

      await createTaskCommand('deploy-app');

      const manifestContent = await fs.readFile(
        path.join(agentosDir, 'modules', 'my-mod', 'module.yaml'),
        'utf8',
      );
      const manifest = YAML.parse(manifestContent);
      expect(manifest.tasks).toContain('tasks/deploy-app.md');
    });
  });

  describe('createWorkflowCommand', () => {
    it('should create valid workflow YAML', async () => {
      await setupProject(tempDir, agentosDir);
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({
        displayName: 'Deploy Pipeline',
        description: 'Full deployment pipeline',
        target: 'core',
      });

      await createWorkflowCommand('deploy-pipeline');

      const content = await fs.readFile(
        path.join(agentosDir, 'core', 'workflows', 'deploy-pipeline.yaml'),
        'utf8',
      );
      const parsed = YAML.parse(content);
      expect(parsed.workflow.id).toBe('deploy-pipeline');
      expect(parsed.workflow.name).toBe('Deploy Pipeline');
      expect(parsed.phases).toHaveLength(2);
      expect(parsed.phases[0].id).toBe('phase-1');
      expect(parsed.phases[1].id).toBe('phase-2');
    });

    it('should create workflow in module and update manifest', async () => {
      await setupProject(tempDir, agentosDir);
      await createModule(agentosDir, 'my-mod');

      vi.mocked(inquirer.prompt).mockResolvedValueOnce({
        displayName: 'CI Pipeline',
        description: 'Continuous integration',
        target: 'my-mod',
      });

      await createWorkflowCommand('ci-pipeline');

      const manifestContent = await fs.readFile(
        path.join(agentosDir, 'modules', 'my-mod', 'module.yaml'),
        'utf8',
      );
      const manifest = YAML.parse(manifestContent);
      expect(manifest.workflows).toContain('workflows/ci-pipeline.yaml');
    });
  });
});

// ─── Helpers ───

async function setupProject(baseDir: string, agentosDir: string) {
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

  // Core agents dir with default agents
  const agentsDir = path.join(agentosDir, 'core', 'agents');
  await fs.mkdir(agentsDir, { recursive: true });
  for (const agent of ['maintainer.md', 'builder.md', 'doctor.md']) {
    await fs.writeFile(path.join(agentsDir, agent), `---\nid: ${agent.replace('.md', '')}\n---\n`, 'utf8');
  }
}

async function createModule(agentosDir: string, name: string) {
  const moduleDir = path.join(agentosDir, 'modules', name);
  for (const dir of ['agents', 'tasks', 'workflows', 'rules']) {
    await fs.mkdir(path.join(moduleDir, dir), { recursive: true });
  }
  const manifest = { name, version: '0.1.0', description: 'Test module', agents: [], tasks: [], workflows: [], rules: [] };
  await fs.writeFile(path.join(moduleDir, 'module.yaml'), YAML.stringify(manifest), 'utf8');
}
