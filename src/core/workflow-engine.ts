import { randomUUID } from 'node:crypto';
import path from 'path';
import chalk from 'chalk';
import { AgentOSConfig, WorkflowDefinition, WorkflowPhase, SessionState } from '../types/index.js';
import { PromptCompiler } from './prompt-compiler.js';
import { hooks } from './hooks.js';
import { generateContinueHere } from './session-continuity.js';
import { detectCrashedSession, cleanStaleSessions, generateSessionTitle, type CrashInfo } from './session-manager.js';
import { getBracket, getMaxContextForRunner } from './context-tracker.js';
import { createExecutor, type RunnerResult } from './runner-executor.js';
import { GotchasMemory } from './gotchas-memory.js';
import { WorkflowLoader } from './workflow-loader.js';
import { SessionStore } from './session-store.js';
import { resolveModel } from './model-profiles.js';
import { DecisionLog } from './decision-log.js';

export class WorkflowEngine {
  private agentosDir: string;
  private baseDir: string;
  private compiler: PromptCompiler;
  private gotchas: GotchasMemory;
  private loader: WorkflowLoader;
  private store: SessionStore;
  private decisions: DecisionLog;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.agentosDir = path.join(baseDir, '.agentos');
    this.compiler = new PromptCompiler(baseDir);
    this.gotchas = new GotchasMemory(baseDir);
    this.loader = new WorkflowLoader(this.agentosDir);
    this.store = new SessionStore(this.agentosDir);
    this.decisions = new DecisionLog(baseDir);
  }

  async start(workflowId: string, config: AgentOSConfig, moduleName?: string): Promise<string> {
    const module = moduleName || this.resolveModule(config);
    const workflow = await this.loader.load(workflowId, module);
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    // Fire-and-forget stale session cleanup on new session start
    const sessionsDir = path.join(this.agentosDir, 'state', 'sessions');
    cleanStaleSessions(sessionsDir).then(cleaned => {
      if (cleaned > 0) console.log(chalk.dim(`  Cleaned ${cleaned} stale session(s).`));
    }).catch((err) => {
      if (process.env.DEBUG) console.error(chalk.dim(`  Stale session cleanup failed: ${err instanceof Error ? err.message : err}`));
    });

    const session: SessionState = {
      sessionId,
      workflowId,
      activeMission: workflow.workflow.name,
      currentAgent: 'master',
      currentPhase: workflow.phases[0]?.id || 'init',
      status: 'running',
      startedAt: now,
      title: generateSessionTitle(workflow.workflow.name, workflow.phases[0]?.name),
      promptCount: 0,
      lastActivity: now,
      contextBracket: 'FRESH',
      tokens: 0,
      costUsd: 0,
      events: [{
        timestamp: now,
        type: 'SESSION_START',
        agent: 'master',
        data: { workflowId, mission: workflow.workflow.name },
      }],
    };

    await this.store.save(session);

    hooks.emit('session:start', {
      sessionId,
      data: { workflowId, activeMission: workflow.workflow.name },
    });

    await this.decisions.record({
      title: `Started workflow: ${workflowId}`,
      context: `Initiated "${workflow.workflow.name}" with ${workflow.phases.length} phases. Model profile: ${config.project.model_profile}.`,
      decision: `Execute workflow "${workflowId}" from module "${module}"`,
      agent: 'master',
      sessionId,
    });

    const hasDependsOn = workflow.phases.some(p => p.dependsOn && p.dependsOn.length > 0);
    if (hasDependsOn) {
      await this.executeWaves(session, workflow, config, module);
    } else {
      await this.executePhase(session, workflow, 0, config, module);
    }
    return sessionId;
  }

  async resume(sessionId: string, config: AgentOSConfig): Promise<CrashInfo | void> {
    const session = await this.store.load(sessionId);
    if (session.status === 'completed') {
      console.log(chalk.yellow(`Session ${sessionId} is already completed.`));
      return;
    }

    const crashMinutes = config.settings.session.crash_detection_minutes;
    const crashInfo = detectCrashedSession(session, crashMinutes);
    if (crashInfo) {
      console.log(chalk.yellow(`\n  Warning: session may have crashed.`));
      console.log(chalk.yellow(`  Last activity: ${crashInfo.minutesSinceActivity}min ago (phase: ${crashInfo.lastPhase}, agent: @${crashInfo.lastAgent})`));
      console.log(chalk.dim(`  Resuming from last known state...\n`));
    }

    const module = this.resolveModule(config);
    const workflow = await this.loader.load(session.workflowId, module);

    const completedPhases = session.events
      .filter(e => e.type === 'PHASE_COMPLETE')
      .map(e => e.phase);
    const nextIndex = workflow.phases.findIndex(p => !completedPhases.includes(p.id));

    if (nextIndex < 0) {
      session.status = 'completed';
      await this.store.save(session);
      return;
    }

    session.status = 'running';
    session.lastActivity = new Date().toISOString();
    session.events.push({
      timestamp: new Date().toISOString(),
      type: 'SESSION_RESUME',
      agent: session.currentAgent,
      data: { crashed: !!crashInfo },
    });
    await this.store.save(session);
    hooks.emit('session:resume', {
      sessionId: session.sessionId,
      agent: session.currentAgent,
      data: { crashed: !!crashInfo, workflowId: session.workflowId },
    });

    const hasDependsOn = workflow.phases.some(p => p.dependsOn && p.dependsOn.length > 0);
    if (hasDependsOn) {
      await this.executeWaves(session, workflow, config, module);
    } else {
      await this.executePhase(session, workflow, nextIndex, config, module);
    }

    return crashInfo ?? undefined;
  }

  /** Public API — delegates to WorkflowLoader */
  async loadWorkflow(id: string, module: string): Promise<WorkflowDefinition> {
    return this.loader.load(id, module);
  }

  /** Public API — delegates to WorkflowLoader */
  async listWorkflows(config: AgentOSConfig): Promise<{ module: string; id: string; name: string }[]> {
    return this.loader.list(config);
  }

  private async executePhase(
    session: SessionState,
    workflow: WorkflowDefinition,
    phaseIndex: number,
    config: AgentOSConfig,
    module: string
  ): Promise<void> {
    const phase = workflow.phases[phaseIndex];

    if (!phase) {
      session.status = 'completed';
      session.events.push({
        timestamp: new Date().toISOString(),
        type: 'SESSION_COMPLETE',
        agent: 'master',
      });
      await this.store.save(session);
      await this.store.updateDashboard(session);
      hooks.emit('session:complete', {
        sessionId: session.sessionId,
        data: { workflowId: session.workflowId, tokens: session.tokens, cost: session.costUsd },
      });
      console.log(chalk.bold.green(`\n  Mission Accomplished: ${workflow.workflow.name}`));
      return;
    }

    const { promptPath, model } = await this.preparePhase(session, phase, config, module);

    if (phase.gate === 'user_approval') {
      await this.pauseAtGate(session, phase, workflow);
      return;
    }

    const result = await this.executeWithRetry(promptPath, phase, session, config, model);
    if (result.exitCode !== 0) {
      await this.handlePhaseFailed(session, phase, workflow, result);
      return;
    }

    await this.completePhase(session, phase, result);

    // Decision routing — scan output for decision keys
    if (phase.decision && result.output) {
      for (const [key, nextId] of Object.entries(phase.decision)) {
        if (result.output.toLowerCase().includes(key.toLowerCase())) {
          const decidedIndex = workflow.phases.findIndex(p => p.id === nextId);
          if (decidedIndex >= 0) {
            console.log(chalk.dim(`  Decision: "${key}" → phase ${nextId}`));
            await this.executePhase(session, workflow, decidedIndex, config, module);
            return;
          }
        }
      }
    }

    const nextPhaseId = phase.next;
    if (nextPhaseId) {
      const nextIndex = workflow.phases.findIndex(p => p.id === nextPhaseId);
      if (nextIndex >= 0) {
        await this.executePhase(session, workflow, nextIndex, config, module);
        return;
      }
    }

    // Sequential fallback
    await this.executePhase(session, workflow, phaseIndex + 1, config, module);
  }

  private calculateWaves(phases: WorkflowPhase[]): WorkflowPhase[][] {
    const completed = new Set<string>();
    const remaining = [...phases];
    const waves: WorkflowPhase[][] = [];

    while (remaining.length > 0) {
      const wave = remaining.filter(p => {
        const deps = p.dependsOn || [];
        return deps.every(d => completed.has(d));
      });

      if (wave.length === 0) {
        console.log(chalk.yellow('  Warning: circular dependency detected, running remaining phases sequentially.'));
        waves.push(...remaining.map(p => [p]));
        break;
      }

      waves.push(wave);
      for (const p of wave) {
        completed.add(p.id);
        remaining.splice(remaining.indexOf(p), 1);
      }
    }
    return waves;
  }

  private async executeWaves(
    session: SessionState,
    workflow: WorkflowDefinition,
    config: AgentOSConfig,
    module: string
  ): Promise<void> {
    const waves = this.calculateWaves(workflow.phases);

    const completedPhases = new Set(
      session.events
        .filter(e => e.type === 'PHASE_COMPLETE')
        .map(e => e.phase)
    );

    for (let wi = 0; wi < waves.length; wi++) {
      const wave = waves[wi].filter(p => !completedPhases.has(p.id));
      if (wave.length === 0) continue;

      if (wave.length > 1) {
        console.log(chalk.blue(`\n  Wave ${wi + 1}: [${wave.map(p => p.name).join(', ')}] (parallel)`));
      }

      if (wave.length === 1) {
        const stopped = await this.executeSinglePhase(session, wave[0], workflow, config, module);
        if (stopped) return;
      } else {
        const results = await Promise.all(
          wave.map(p => this.executeSinglePhase(session, p, workflow, config, module))
        );
        if (results.some(stopped => stopped)) return;
      }
    }

    session.status = 'completed';
    session.events.push({
      timestamp: new Date().toISOString(),
      type: 'SESSION_COMPLETE',
      agent: 'master',
    });
    await this.store.save(session);
    await this.store.updateDashboard(session);
    hooks.emit('session:complete', {
      sessionId: session.sessionId,
      data: { workflowId: session.workflowId, tokens: session.tokens, cost: session.costUsd },
    });
    console.log(chalk.bold.green(`\n  Mission Accomplished: ${workflow.workflow.name}`));
  }

  private async executeSinglePhase(
    session: SessionState,
    phase: WorkflowPhase,
    workflow: WorkflowDefinition,
    config: AgentOSConfig,
    module: string
  ): Promise<boolean> {
    const { promptPath, model } = await this.preparePhase(session, phase, config, module);

    if (phase.gate === 'user_approval') {
      await this.pauseAtGate(session, phase, workflow);
      return true;
    }

    const result = await this.executeWithRetry(promptPath, phase, session, config, model);
    if (result.exitCode !== 0) {
      await this.handlePhaseFailed(session, phase, workflow, result);
      return true;
    }

    await this.completePhase(session, phase, result);
    return false;
  }

  // ─── Shared helpers for phase lifecycle ───

  private async preparePhase(
    session: SessionState,
    phase: WorkflowPhase,
    config: AgentOSConfig,
    module: string
  ): Promise<{ promptPath: string; bracket: ReturnType<typeof getBracket>; model: string | undefined }> {
    session.currentAgent = phase.agent;
    session.currentPhase = phase.id;
    session.promptCount = (session.promptCount || 0) + 1;
    session.lastActivity = new Date().toISOString();
    const maxCtx = getMaxContextForRunner(config.project.runner);
    const bracket = getBracket(session.promptCount, maxCtx);
    session.contextBracket = bracket.bracket;
    session.events.push({
      timestamp: new Date().toISOString(),
      type: 'PHASE_START',
      agent: phase.agent,
      phase: phase.id,
      data: { name: phase.name, task: phase.task, bracket: bracket.bracket },
    });
    await this.store.save(session);

    hooks.emit('step:start', {
      sessionId: session.sessionId,
      agent: phase.agent,
      data: { stepName: phase.name, task: phase.task },
    });

    const taskId = phase.task.replace('.md', '').replace('.yaml', '');
    const promptPath = await this.compiler.compile({
      agentId: phase.agent,
      taskId,
      module,
      sessionId: session.sessionId,
      promptCount: session.promptCount,
      runner: config.project.runner,
    }, config);

    const model = resolveModel(
      config.project.runner,
      config.project.model_profile,
      phase.agent,
      config.project.model_overrides,
    );

    const modelLabel = model ? ` | model: ${model}` : '';
    console.log(`\n  [${phase.name}] Agent: @${phase.agent} | bracket: ${bracket.bracket}${modelLabel}`);
    console.log(`  Task: ${taskId}`);
    console.log(chalk.dim(`  Prompt: ${path.relative(process.cwd(), promptPath)}`));

    return { promptPath, bracket, model };
  }

  private async pauseAtGate(
    session: SessionState,
    phase: WorkflowPhase,
    workflow: WorkflowDefinition
  ): Promise<void> {
    session.status = 'paused';
    session.events.push({
      timestamp: new Date().toISOString(),
      type: 'GATE_PAUSE',
      agent: phase.agent,
      phase: phase.id,
      data: { gate: 'user_approval' },
    });
    await this.store.save(session);
    await this.store.updateDashboard(session);
    await generateContinueHere(session, workflow, this.agentosDir, 'paused (gate: user_approval)');
    hooks.emit('session:pause', {
      sessionId: session.sessionId,
      agent: phase.agent,
      data: { phase: phase.id, gate: 'user_approval' },
    });
    await this.decisions.record({
      title: `Gate: ${phase.name}`,
      context: `Phase "${phase.id}" requires user approval before proceeding.`,
      decision: 'Paused for user approval',
      agent: phase.agent,
      sessionId: session.sessionId,
      phase: phase.id,
    });
    console.log(chalk.yellow(`  Paused: waiting for user approval.`));
    console.log(chalk.dim(`  Handoff: .agentos/state/.handoff.md`));
    console.log(chalk.dim(`  Resume with: agentos run ${session.workflowId} --resume ${session.sessionId}`));
  }

  private async handlePhaseFailed(
    session: SessionState,
    phase: WorkflowPhase,
    workflow: WorkflowDefinition,
    result: RunnerResult
  ): Promise<void> {
    session.status = 'failed';
    session.events.push({
      timestamp: new Date().toISOString(),
      type: 'PHASE_FAILED',
      agent: phase.agent,
      phase: phase.id,
      data: { error: result.error, exitCode: result.exitCode },
    });
    await this.store.save(session);
    await this.store.updateDashboard(session);
    await generateContinueHere(session, workflow, this.agentosDir, `failed at phase ${phase.id}: ${result.error?.slice(0, 100)}`);
    hooks.emit('step:failed', {
      sessionId: session.sessionId,
      agent: phase.agent,
      data: { phase: phase.id, error: result.error, exitCode: result.exitCode },
    });
    await this.decisions.record({
      title: `Failed: ${phase.name}`,
      context: `Phase "${phase.id}" failed with exit code ${result.exitCode}.`,
      decision: `Stopped execution. Error: ${result.error?.slice(0, 200) || 'unknown'}`,
      agent: phase.agent,
      sessionId: session.sessionId,
      phase: phase.id,
    });
    console.log(chalk.dim(`  Resume with: agentos run ${session.workflowId} --resume ${session.sessionId}`));
  }

  private async completePhase(
    session: SessionState,
    phase: WorkflowPhase,
    result: RunnerResult
  ): Promise<void> {
    session.events.push({
      timestamp: new Date().toISOString(),
      type: 'PHASE_COMPLETE',
      agent: phase.agent,
      phase: phase.id,
      data: { tokens: result.tokensUsed, cost: result.costUsd, durationMs: result.durationMs },
    });
    await this.store.save(session);
    await this.store.updateDashboard(session);

    hooks.emit('step:complete', {
      sessionId: session.sessionId,
      agent: phase.agent,
      data: { stepName: phase.name, tokens: result.tokensUsed, cost: result.costUsd },
    });
  }

  private async executePrompt(
    promptPath: string,
    phase: WorkflowPhase,
    session: SessionState,
    config: AgentOSConfig,
    model?: string,
  ): Promise<RunnerResult> {
    const executor = await createExecutor(config.project.runner);

    if (executor.name === 'manual') {
      console.log(chalk.dim(`  Runner: manual — execute the prompt file and resume when done.`));
      return { output: '', exitCode: 0, tokensUsed: 0, costUsd: 0, durationMs: 0 };
    }

    const modelLabel = model ? ` (model: ${model})` : '';
    console.log(chalk.dim(`  Runner: ${executor.name}${modelLabel} — executing...`));

    try {
      const result = await executor.run(promptPath, this.baseDir, phase.timeoutMs, model);

      session.tokens = (session.tokens || 0) + result.tokensUsed;
      session.costUsd = (session.costUsd || 0) + result.costUsd;
      session.lastActivity = new Date().toISOString();

      const durationSec = (result.durationMs / 1000).toFixed(1);
      if (result.exitCode === 0) {
        console.log(chalk.green(`  Done in ${durationSec}s | tokens: ${result.tokensUsed} | cost: $${result.costUsd.toFixed(4)}`));
      } else {
        console.log(chalk.red(`  Failed (exit ${result.exitCode}) after ${durationSec}s`));
        if (result.error) {
          console.log(chalk.red(`  Error: ${result.error.slice(0, 200)}`));
        }
        if (result.error) {
          await this.gotchas.recordError(result.error, phase.agent, 'execution');
        }
      }

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`  Runner crashed: ${errorMsg.slice(0, 200)}`));
      await this.gotchas.recordError(errorMsg, phase.agent, 'execution');
      return {
        output: '',
        exitCode: 1,
        tokensUsed: 0,
        costUsd: 0,
        error: errorMsg,
        durationMs: 0,
      };
    }
  }

  private async executeWithRetry(
    promptPath: string,
    phase: WorkflowPhase,
    session: SessionState,
    config: AgentOSConfig,
    model?: string,
  ): Promise<RunnerResult> {
    const maxRetries = phase.retry || 0;
    let result: RunnerResult;
    let attempt = 0;

    do {
      if (attempt > 0) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
        console.log(chalk.yellow(`  Retry ${attempt}/${maxRetries} in ${(backoffMs / 1000).toFixed(0)}s...`));
        await new Promise(r => setTimeout(r, backoffMs));
      }
      result = await this.executePrompt(promptPath, phase, session, config, model);
      attempt++;
    } while (result.exitCode !== 0 && attempt <= maxRetries);

    return result;
  }

  private resolveModule(config: AgentOSConfig): string {
    return config.modules.installed[0]?.name || 'sdlc';
  }
}
