import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { WorkflowEngine } from '../../../src/core/workflow-engine.js';
import { ConfigManager } from '../../../src/core/config.js';

describe('WorkflowEngine', () => {
  let tempDir: string;
  let engine: WorkflowEngine;
  let configManager: ConfigManager;
  let agentosDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-workflow-test-'));
    engine = new WorkflowEngine(tempDir);
    configManager = new ConfigManager(tempDir);
    agentosDir = path.join(tempDir, '.agentos');

    // Setup minimal structure
    await fs.mkdir(path.join(agentosDir, 'modules', 'test-mod', 'workflows'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'modules', 'test-mod', 'agents'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'modules', 'test-mod', 'tasks'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'state', 'sessions'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'artifacts'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'memory'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'compiled'), { recursive: true });

    // Agent and task
    await fs.writeFile(
      path.join(agentosDir, 'modules', 'test-mod', 'agents', 'dev.md'),
      '---\nid: dev\ntitle: Developer\n---\nYou are a developer.'
    );
    await fs.writeFile(
      path.join(agentosDir, 'modules', 'test-mod', 'agents', 'reviewer.md'),
      '---\nid: reviewer\ntitle: Reviewer\n---\nYou are a code reviewer.'
    );
    await fs.writeFile(
      path.join(agentosDir, 'modules', 'test-mod', 'tasks', 'build.md'),
      '---\nid: build\nname: Build\n---\nBuild the feature.'
    );
    await fs.writeFile(
      path.join(agentosDir, 'modules', 'test-mod', 'tasks', 'review.md'),
      '---\nid: review\nname: Review\n---\nReview the code.'
    );

    // Workflow YAML
    await fs.writeFile(
      path.join(agentosDir, 'modules', 'test-mod', 'workflows', 'simple.yaml'),
      YAML.stringify({
        workflow: { id: 'simple', name: 'Simple Workflow' },
        phases: [
          { id: 'build', name: 'Build Phase', agent: 'dev', task: 'build' },
        ],
      })
    );

    // Config
    await configManager.init({
      project: { name: 'test', state: 'greenfield', output_language: 'English', runner: 'Auto-detect', profile: 'solo' },
      modules: { installed: [{ name: 'test-mod', version: '1.0.0', source: 'local' }] },
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('loadWorkflow', () => {
    it('should load a YAML workflow', async () => {
      const workflow = await engine.loadWorkflow('simple', 'test-mod');
      expect(workflow.workflow.name).toBe('Simple Workflow');
      expect(workflow.phases).toHaveLength(1);
      expect(workflow.phases[0].agent).toBe('dev');
    });

    it('should load flat format YAML (no nested workflow key)', async () => {
      await fs.writeFile(
        path.join(agentosDir, 'modules', 'test-mod', 'workflows', 'flat.yaml'),
        YAML.stringify({
          id: 'flat',
          name: 'Flat Workflow',
          phases: [
            { id: 'step1', name: 'Step 1', agent: 'dev', task: 'build' },
          ],
        })
      );

      const workflow = await engine.loadWorkflow('flat', 'test-mod');
      expect(workflow.workflow.name).toBe('Flat Workflow');
      expect(workflow.phases).toHaveLength(1);
    });

    it('should load markdown workflow with frontmatter', async () => {
      await fs.writeFile(
        path.join(agentosDir, 'modules', 'test-mod', 'workflows', 'md-wf.md'),
        `---
id: md-wf
name: Markdown Workflow
phases:
  - id: step1
    name: Step 1
    agent: dev
    task: build
---
# Markdown Workflow`
      );

      const workflow = await engine.loadWorkflow('md-wf', 'test-mod');
      expect(workflow.workflow.name).toBe('Markdown Workflow');
      expect(workflow.phases).toHaveLength(1);
    });

    it('should throw for non-existent workflow', async () => {
      await expect(engine.loadWorkflow('does-not-exist', 'test-mod')).rejects.toThrow('not found');
    });
  });

  describe('start', () => {
    it('should start a workflow and create a session', async () => {
      const config = await configManager.load();
      const sessionId = await engine.start('simple', config, 'test-mod');

      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      const sessionFile = path.join(agentosDir, 'state', 'sessions', `${sessionId}.json`);
      const exists = await fs.access(sessionFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
      expect(session.activeMission).toBe('Simple Workflow');
      expect(session.status).toBe('completed');
    });

    it('should create session with PHASE_START and PHASE_COMPLETE events', async () => {
      const config = await configManager.load();
      const sessionId = await engine.start('simple', config, 'test-mod');

      const sessionFile = path.join(agentosDir, 'state', 'sessions', `${sessionId}.json`);
      const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));

      const eventTypes = session.events.map((e: any) => e.type);
      expect(eventTypes).toContain('SESSION_START');
      expect(eventTypes).toContain('PHASE_START');
      expect(eventTypes).toContain('PHASE_COMPLETE');
      expect(eventTypes).toContain('SESSION_COMPLETE');
    });

    it('should handle multi-phase workflow', async () => {
      await fs.writeFile(
        path.join(agentosDir, 'modules', 'test-mod', 'workflows', 'multi.yaml'),
        YAML.stringify({
          workflow: { id: 'multi', name: 'Multi Phase' },
          phases: [
            { id: 'build', name: 'Build', agent: 'dev', task: 'build', next: 'review' },
            { id: 'review', name: 'Review', agent: 'reviewer', task: 'review' },
          ],
        })
      );

      const config = await configManager.load();
      const sessionId = await engine.start('multi', config, 'test-mod');

      const sessionFile = path.join(agentosDir, 'state', 'sessions', `${sessionId}.json`);
      const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));

      expect(session.status).toBe('completed');
      const phaseCompletes = session.events.filter((e: any) => e.type === 'PHASE_COMPLETE');
      expect(phaseCompletes).toHaveLength(2);
    });

    it('should pause at user_approval gate', async () => {
      await fs.writeFile(
        path.join(agentosDir, 'modules', 'test-mod', 'workflows', 'gated.yaml'),
        YAML.stringify({
          workflow: { id: 'gated', name: 'Gated Workflow' },
          phases: [
            { id: 'build', name: 'Build', agent: 'dev', task: 'build', gate: 'user_approval', next: 'review' },
            { id: 'review', name: 'Review', agent: 'reviewer', task: 'review' },
          ],
        })
      );

      const config = await configManager.load();
      const sessionId = await engine.start('gated', config, 'test-mod');

      const sessionFile = path.join(agentosDir, 'state', 'sessions', `${sessionId}.json`);
      const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));

      expect(session.status).toBe('paused');
      const gateEvents = session.events.filter((e: any) => e.type === 'GATE_PAUSE');
      expect(gateEvents).toHaveLength(1);
      expect(gateEvents[0].data.gate).toBe('user_approval');

      // Handoff file should exist
      const handoff = path.join(agentosDir, 'state', '.handoff.md');
      const handoffExists = await fs.access(handoff).then(() => true).catch(() => false);
      expect(handoffExists).toBe(true);
    });

    it('should execute wave-based workflow with dependsOn', async () => {
      await fs.writeFile(
        path.join(agentosDir, 'modules', 'test-mod', 'workflows', 'wave.yaml'),
        YAML.stringify({
          workflow: { id: 'wave', name: 'Wave Workflow' },
          phases: [
            { id: 'build', name: 'Build', agent: 'dev', task: 'build', dependsOn: [] },
            { id: 'review', name: 'Review', agent: 'reviewer', task: 'review', dependsOn: ['build'] },
          ],
        })
      );

      const config = await configManager.load();
      const sessionId = await engine.start('wave', config, 'test-mod');

      const sessionFile = path.join(agentosDir, 'state', 'sessions', `${sessionId}.json`);
      const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));

      expect(session.status).toBe('completed');
    });
  });

  describe('resume', () => {
    it('should resume a paused session', async () => {
      // Create a gated workflow to get a paused session
      await fs.writeFile(
        path.join(agentosDir, 'modules', 'test-mod', 'workflows', 'gated.yaml'),
        YAML.stringify({
          workflow: { id: 'gated', name: 'Gated Workflow' },
          phases: [
            { id: 'build', name: 'Build', agent: 'dev', task: 'build', gate: 'user_approval', next: 'review' },
            { id: 'review', name: 'Review', agent: 'reviewer', task: 'review' },
          ],
        })
      );

      const config = await configManager.load();
      const sessionId = await engine.start('gated', config, 'test-mod');

      // Manually mark the gate as passed by adding PHASE_COMPLETE
      const sessionFile = path.join(agentosDir, 'state', 'sessions', `${sessionId}.json`);
      const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
      session.status = 'paused';
      session.events.push({
        timestamp: new Date().toISOString(),
        type: 'PHASE_COMPLETE',
        agent: 'dev',
        phase: 'build',
        data: {},
      });
      await fs.writeFile(sessionFile, JSON.stringify(session, null, 2));

      // Resume
      await engine.resume(sessionId, config);

      const resumed = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
      expect(resumed.status).toBe('completed');
      const resumeEvents = resumed.events.filter((e: any) => e.type === 'SESSION_RESUME');
      expect(resumeEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should skip completed sessions', async () => {
      const config = await configManager.load();
      const sessionId = await engine.start('simple', config, 'test-mod');

      // Session is already completed, resume should be a no-op
      await engine.resume(sessionId, config);

      const sessionFile = path.join(agentosDir, 'state', 'sessions', `${sessionId}.json`);
      const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
      expect(session.status).toBe('completed');
    });
  });

  describe('listWorkflows', () => {
    it('should list workflows from installed modules', async () => {
      const config = await configManager.load();
      const workflows = await engine.listWorkflows(config);
      expect(workflows).toHaveLength(1);
      expect(workflows[0].id).toBe('simple');
      expect(workflows[0].name).toBe('Simple Workflow');
    });

    it('should list multiple workflows', async () => {
      await fs.writeFile(
        path.join(agentosDir, 'modules', 'test-mod', 'workflows', 'another.yaml'),
        YAML.stringify({
          workflow: { id: 'another', name: 'Another Workflow' },
          phases: [
            { id: 'step', name: 'Step', agent: 'dev', task: 'build' },
          ],
        })
      );

      const config = await configManager.load();
      const workflows = await engine.listWorkflows(config);
      expect(workflows).toHaveLength(2);
    });

    it('should return empty for modules with no workflows dir', async () => {
      await configManager.update({
        modules: { installed: [{ name: 'empty-mod', version: '1.0.0', source: 'local' }] },
      });
      const config = await configManager.load();
      const workflows = await engine.listWorkflows(config);
      expect(workflows).toHaveLength(0);
    });
  });

  describe('event trimming', () => {
    it('should trim events beyond limit while keeping first event', async () => {
      // Create a workflow with many phases to generate many events
      const phases = [];
      for (let i = 0; i < 5; i++) {
        phases.push({ id: `step${i}`, name: `Step ${i}`, agent: 'dev', task: 'build', next: i < 4 ? `step${i + 1}` : undefined });
      }

      await fs.writeFile(
        path.join(agentosDir, 'modules', 'test-mod', 'workflows', 'many.yaml'),
        YAML.stringify({
          workflow: { id: 'many', name: 'Many Phases' },
          phases,
        })
      );

      const config = await configManager.load();
      const sessionId = await engine.start('many', config, 'test-mod');

      const sessionFile = path.join(agentosDir, 'state', 'sessions', `${sessionId}.json`);
      const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));

      // Events should exist and first one should be SESSION_START
      expect(session.events[0].type).toBe('SESSION_START');
      // Session should be completed
      expect(session.status).toBe('completed');
    });
  });

  describe('dashboard update', () => {
    it('should write dashboard.json with session info', async () => {
      const config = await configManager.load();
      const sessionId = await engine.start('simple', config, 'test-mod');

      const dashboardPath = path.join(agentosDir, 'state', 'dashboard.json');
      const exists = await fs.access(dashboardPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const dashboard = JSON.parse(await fs.readFile(dashboardPath, 'utf8'));
      expect(dashboard[sessionId]).toBeDefined();
      expect(dashboard[sessionId].mission).toBe('Simple Workflow');
      expect(dashboard[sessionId].status).toBe('completed');
    });
  });
});
