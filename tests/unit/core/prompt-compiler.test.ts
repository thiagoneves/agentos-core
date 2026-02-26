import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { PromptCompiler } from '../../../src/core/prompt-compiler.js';

describe('PromptCompiler', () => {
  let tempDir: string;
  let compiler: PromptCompiler;
  let agentosDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-compiler-test-'));
    compiler = new PromptCompiler(tempDir);
    agentosDir = path.join(tempDir, '.agentos');

    await fs.mkdir(path.join(agentosDir, 'modules', 'sdlc', 'agents'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'modules', 'sdlc', 'tasks'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'artifacts'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'memory'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'compiled'), { recursive: true });

    await fs.writeFile(
      path.join(agentosDir, 'modules', 'sdlc', 'agents', 'test-agent.md'),
      '---\nid: test-agent\ntitle: Test Agent\n---\nYou are a test agent.'
    );
    await fs.writeFile(
      path.join(agentosDir, 'modules', 'sdlc', 'tasks', 'test-task.md'),
      '---\nid: test-task\nname: Test Task\n---\nDo the test task.'
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should compile a prompt with agent and task content', async () => {
    const config = {
      project: { output_language: 'English' },
      settings: { tokens: { index_enabled: true } },
    } as any;

    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
    }, config);

    expect(outputPath).toContain('test-task');
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('You are a test agent.');
    expect(content).toContain('Do the test task.');
    expect(content).toContain('English');
  });

  it('should include rules when present', async () => {
    const rulesDir = path.join(agentosDir, 'modules', 'sdlc', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.writeFile(path.join(rulesDir, 'test-rule.md'), '# Always be nice');

    const config = { project: { output_language: 'English' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({ agentId: 'test-agent', taskId: 'test-task' }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('Always be nice');
  });

  it('should include bracket comment in output', async () => {
    const config = { project: { output_language: 'English' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
      promptCount: 0,
    }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('bracket: FRESH');
  });

  it('should include session history when bracket is MODERATE', async () => {
    // Create a summary for the session
    await fs.mkdir(path.join(agentosDir, 'memory', 'summaries'), { recursive: true });
    await fs.writeFile(
      path.join(agentosDir, 'memory', 'summaries', 'test-session.md'),
      '# Session Summary\nDid some work.'
    );

    const config = { project: { output_language: 'English', runner: 'Auto-detect' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
      sessionId: 'test-session',
      promptCount: 30, // MODERATE bracket
      runner: 'Auto-detect',
    }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('session_history');
  });

  it('should NOT include session history when bracket is FRESH', async () => {
    await fs.mkdir(path.join(agentosDir, 'memory', 'summaries'), { recursive: true });
    await fs.writeFile(
      path.join(agentosDir, 'memory', 'summaries', 'test-session.md'),
      '# Session Summary'
    );

    const config = { project: { output_language: 'English' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
      sessionId: 'test-session',
      promptCount: 0, // FRESH bracket
    }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).not.toContain('session_history');
  });

  it('should include artifact index when bracket is MODERATE', async () => {
    // Create an artifact
    await fs.writeFile(path.join(agentosDir, 'artifacts', 'doc.md'), '# My doc');

    const config = { project: { output_language: 'English', runner: 'Auto-detect' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
      promptCount: 30,
      runner: 'Auto-detect',
    }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('artifact_index');
  });

  it('should include context files when provided', async () => {
    // Create a context file
    const contextFile = path.join(tempDir, 'src', 'app.ts');
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(contextFile, 'const x = 42;');

    const config = { project: { output_language: 'English' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
      contextFiles: [contextFile],
    }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('const x = 42');
  });

  it('should handle missing context files gracefully', async () => {
    const config = { project: { output_language: 'English' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
      contextFiles: ['/nonexistent/file.ts'],
    }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('File not found or inaccessible');
  });

  it('should include output constraints with language', async () => {
    const config = { project: { output_language: 'Portuguese' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
    }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('Portuguese');
    expect(content).toContain('output_constraints');
  });

  it('should include continue_here when handoff file exists and bracket is not FRESH', async () => {
    await fs.mkdir(path.join(agentosDir, 'state'), { recursive: true });
    await fs.writeFile(
      path.join(agentosDir, 'state', '.handoff.md'),
      '# Handoff\nResume from here.'
    );

    const config = { project: { output_language: 'English', runner: 'Auto-detect' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
      promptCount: 30,
      runner: 'Auto-detect',
    }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('continue_here');
    expect(content).toContain('Resume from here');
  });

  it('should include handoff warning when bracket is CRITICAL', async () => {
    const config = { project: { output_language: 'English', runner: 'Auto-detect' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
      promptCount: 50, // CRITICAL bracket
      runner: 'Auto-detect',
    }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('handoff_warning');
    expect(content).toContain('Context window is critically low');
  });

  it('should include project context when 00-context.md exists', async () => {
    await fs.writeFile(
      path.join(agentosDir, 'artifacts', '00-context.md'),
      '# Project Identity\nWe are building AgentOS.'
    );

    const config = { project: { output_language: 'English' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
    }, config);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('We are building AgentOS');
  });

  it('should save compiled prompt to compiled directory', async () => {
    const config = { project: { output_language: 'English' }, settings: { tokens: { index_enabled: true } } } as any;
    const outputPath = await compiler.compile({
      agentId: 'test-agent',
      taskId: 'test-task',
    }, config);

    expect(outputPath).toContain('.agentos/compiled/');
    expect(outputPath).toContain('.prompt.md');
    const exists = await fs.access(outputPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
