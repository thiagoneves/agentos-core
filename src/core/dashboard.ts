import fs from 'fs/promises';
import path from 'path';
import { hooks } from './hooks.js';
import type { SessionEvent, SessionStatus } from '../types/index.js';

export interface SessionMetrics {
  sessionId: string;
  workflowId: string;
  activeMission: string;
  currentAgent: string;
  currentPhase: string;
  status: SessionStatus;
  tokens: number;
  costUsd: number;
  events: SessionEvent[];
}

export class DashboardManager {
  private agentosDir: string;
  private sessionsDir: string;
  private globalMetricsPath: string;

  constructor(baseDir: string = process.cwd()) {
    this.agentosDir = path.join(baseDir, '.agentos');
    this.sessionsDir = path.join(this.agentosDir, 'state', 'sessions');
    this.globalMetricsPath = path.join(this.agentosDir, 'state', 'global-metrics.json');
    this.setupHooks();
  }

  private setupHooks() {
    hooks.on('session:start', async (p) => {
      await this.updateSession(p.sessionId, {
        workflowId: p.data?.workflowId,
        activeMission: p.data?.activeMission || 'Starting...',
        status: 'running',
        currentAgent: 'master',
        currentPhase: 'Initializing'
      }, { type: 'SESSION_START', agent: 'master', data: p.data });
    });

    hooks.on('step:start', async (p) => {
      await this.updateSession(p.sessionId, {
        currentAgent: p.agent,
        currentPhase: p.data?.stepName
      }, { type: 'STEP_START', agent: p.agent || 'unknown', data: p.data });
    });

    hooks.on('step:complete', async (p) => {
      await this.updateSession(p.sessionId, {
        tokens: p.data?.tokens || 0,
        costUsd: p.data?.cost || 0
      }, { type: 'STEP_COMPLETE', agent: p.agent || 'unknown', data: p.data });
    });

    hooks.on('metrics:update', async (p) => {
      await this.updateSession(p.sessionId, {
        currentPhase: p.data?.currentPhase as string,
        status: p.data?.status as SessionMetrics['status'],
        tokens: p.data?.tokens || 0,
        costUsd: p.data?.cost || 0
      });
    });

    hooks.on('session:complete', async (p) => {
      await this.updateSession(p.sessionId, {
        status: 'completed',
      }, { type: 'SESSION_COMPLETE', agent: 'master', data: p.data });
    });

    hooks.on('session:pause', async (p) => {
      await this.updateSession(p.sessionId, {
        status: 'paused',
      }, { type: 'GATE_PAUSE', agent: p.agent || 'unknown', data: p.data });
    });

    hooks.on('session:resume', async (p) => {
      await this.updateSession(p.sessionId, {
        status: 'running',
      }, { type: 'SESSION_RESUME', agent: p.agent || 'unknown', data: p.data });
    });

    hooks.on('step:failed', async (p) => {
      await this.updateSession(p.sessionId, {
        status: 'failed',
      }, { type: 'PHASE_FAILED', agent: p.agent || 'unknown', data: p.data });
    });
  }

  private async updateSession(sessionId: string, update: Partial<SessionMetrics>, event?: Omit<SessionEvent, 'timestamp'>) {
    const session = await this.loadSession(sessionId);
    
    const updatedSession: SessionMetrics = {
      ...session,
      ...update,
      tokens: (session.tokens || 0) + (update.tokens || 0),
      costUsd: (session.costUsd || 0) + (update.costUsd || 0)
    };

    if (event) {
      updatedSession.events.push({
        ...event,
        timestamp: new Date().toISOString()
      });
    }

    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(this.sessionsDir, `${sessionId}.json`),
      JSON.stringify(updatedSession, null, 2),
      'utf8'
    );

    await this.updateGlobalMetrics(update.tokens || 0, update.costUsd || 0);
  }

  private async loadSession(id: string): Promise<SessionMetrics> {
    try {
      const content = await fs.readFile(path.join(this.sessionsDir, `${id}.json`), 'utf8');
      return JSON.parse(content);
    } catch {
      return {
        sessionId: id,
        workflowId: 'unknown',
        activeMission: 'Initializing...',
        currentAgent: 'master',
        currentPhase: 'Starting',
        status: 'running',
        tokens: 0,
        costUsd: 0,
        events: []
      };
    }
  }

  private async updateGlobalMetrics(tokens: number, cost: number) {
    let global = { total_tokens: 0, total_cost_usd: 0 };
    try {
      const content = await fs.readFile(this.globalMetricsPath, 'utf8');
      const parsed = JSON.parse(content);
      if (typeof parsed.total_tokens === 'number') global.total_tokens = parsed.total_tokens;
      if (typeof parsed.total_cost_usd === 'number') global.total_cost_usd = parsed.total_cost_usd;
    } catch {
      // File doesn't exist or is corrupted — start fresh
    }

    global.total_tokens += tokens;
    global.total_cost_usd += cost;

    await fs.mkdir(path.dirname(this.globalMetricsPath), { recursive: true });
    await fs.writeFile(this.globalMetricsPath, JSON.stringify(global, null, 2), 'utf8');
  }
}
