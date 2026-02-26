import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { errorMessage } from '../core/errors.js';
import { atomicWrite } from '../core/atomic-fs.js';

interface SessionFile {
  sessionId: string;
  workflowId: string;
  activeMission: string;
  currentAgent: string;
  currentPhase: string;
  status: string;
  tokens: number;
  costUsd: number;
  events: Array<{ timestamp: string; type: string; agent: string; data?: Record<string, unknown> }>;
}

export const reportCommand = async (options: {
  sessionId?: string,
  step?: string,
  status?: string,
  tokens?: string,
  cost?: string,
  agent?: string,
}) => {
  const sessionsDir = path.join(process.cwd(), '.agentos', 'state', 'sessions');
  const sessionId = options.sessionId || await findActiveSession(sessionsDir);

  if (!sessionId) {
    console.error(chalk.red('[AgentOS] No active session found. Use --sessionId to specify one.'));
    return;
  }

  try {
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionPath = path.join(sessionsDir, `${sessionId}.json`);

    let session: SessionFile;
    try {
      const content = await fs.readFile(sessionPath, 'utf8');
      session = JSON.parse(content);
    } catch {
      session = {
        sessionId,
        workflowId: 'manual',
        activeMission: options.step || 'Manual session',
        currentAgent: 'unknown',
        currentPhase: 'Starting',
        status: 'running',
        tokens: 0,
        costUsd: 0,
        events: [],
      };
    }

    const tokens = parseInt(options.tokens || '0');
    const cost = parseFloat(options.cost || '0');

    if (options.step) session.currentPhase = options.step;
    if (options.status) session.status = options.status;
    if (options.agent) session.currentAgent = options.agent;
    session.tokens += tokens;
    session.costUsd += cost;

    const agentName = options.agent || session.currentAgent;

    session.events.push({
      timestamp: new Date().toISOString(),
      type: options.status === 'completed' ? 'STEP_COMPLETE' : 'METRICS_UPDATE',
      agent: agentName,
      data: { step: options.step, status: options.status, tokens, cost, agent: agentName },
    });

    await atomicWrite(sessionPath, JSON.stringify(session, null, 2));
    console.log(chalk.dim(`[AgentOS] Progress reported for session: ${sessionId}`));
  } catch (err) {
    console.error(chalk.red(`[AgentOS] Report failed: ${errorMessage(err)}`));
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
