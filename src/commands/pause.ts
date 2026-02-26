import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import YAML from 'yaml';
import { generateContinueHere } from '../core/session-continuity.js';
import { WorkflowEngine } from '../core/workflow-engine.js';
import { SessionState } from '../types/index.js';
import { errorMessage } from '../core/errors.js';
import { atomicWrite } from '../core/atomic-fs.js';

export const pauseCommand = async (options: { sessionId?: string }) => {
  const agentosDir = path.join(process.cwd(), '.agentos');
  const sessionsDir = path.join(agentosDir, 'state', 'sessions');
  const sessionId = options.sessionId || await findActiveSession(sessionsDir);

  if (!sessionId) {
    console.error(chalk.red('[AgentOS] No active session found. Use --sessionId to specify one.'));
    return;
  }

  try {
    const sessionPath = path.join(sessionsDir, `${sessionId}.json`);
    const content = await fs.readFile(sessionPath, 'utf8');
    const session: SessionState = JSON.parse(content);

    // Load workflow to get phase info
    const engine = new WorkflowEngine();
    let workflow;
    try {
      const module = await resolveModule(agentosDir);
      workflow = await engine.loadWorkflow(session.workflowId, module);
    } catch {
      // Fallback: create minimal workflow from session events
      workflow = {
        workflow: { id: session.workflowId, name: session.activeMission },
        phases: [],
      };
    }

    // Update session status
    session.status = 'paused';
    session.events.push({
      timestamp: new Date().toISOString(),
      type: 'GATE_PAUSE',
      agent: session.currentAgent,
      phase: session.currentPhase,
      data: { gate: 'context_low', reason: 'Manual pause via aos pause' },
    });
    await atomicWrite(sessionPath, JSON.stringify(session, null, 2));

    // Generate handoff file
    const filePath = await generateContinueHere(session, workflow, agentosDir, 'paused (manual)');

    console.log(chalk.green(`\n  Session paused: ${sessionId}`));
    console.log(chalk.dim(`  Handoff file: ${path.relative(process.cwd(), filePath)}`));
    console.log(chalk.dim(`  Resume with: aos run ${session.workflowId} --resume ${sessionId}\n`));
  } catch (err) {
    console.error(chalk.red(`[AgentOS] Pause failed: ${errorMessage(err)}`));
  }
};

async function findActiveSession(sessionsDir: string): Promise<string | null> {
  try {
    const files = await fs.readdir(sessionsDir);
    for (const file of files.reverse()) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(sessionsDir, file), 'utf8');
      const session = JSON.parse(content);
      if (session.status === 'running') return session.sessionId;
    }
  } catch { /* no sessions dir */ }
  return null;
}

async function resolveModule(agentosDir: string): Promise<string> {
  try {
    const configPath = path.join(agentosDir, 'config.yaml');
    const content = await fs.readFile(configPath, 'utf8');
    const config = YAML.parse(content);
    return config.modules?.installed?.[0]?.name || 'sdlc';
  } catch {
    return 'sdlc';
  }
}
