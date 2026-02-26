import fs from 'fs/promises';
import path from 'path';
import type { SessionState } from '../types/index.js';
import { atomicWrite } from './atomic-fs.js';

export class SessionStore {
  private agentosDir: string;

  constructor(agentosDir: string) {
    this.agentosDir = agentosDir;
  }

  async save(session: SessionState, maxEvents?: number): Promise<void> {
    const limit = maxEvents || 200;
    if (session.events.length > limit) {
      const first = session.events[0];
      session.events = [first, ...session.events.slice(-(limit - 1))];
    }

    const sessionsDir = path.join(this.agentosDir, 'state', 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    await atomicWrite(
      path.join(sessionsDir, `${session.sessionId}.json`),
      JSON.stringify(session, null, 2),
    );
  }

  async load(sessionId: string): Promise<SessionState> {
    const content = await fs.readFile(
      path.join(this.agentosDir, 'state', 'sessions', `${sessionId}.json`),
      'utf8'
    );
    return JSON.parse(content) as SessionState;
  }

  async updateDashboard(session: SessionState): Promise<void> {
    const dashboardPath = path.join(this.agentosDir, 'state', 'dashboard.json');
    let dashboard: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(dashboardPath, 'utf8');
      dashboard = JSON.parse(content);
    } catch { /* fresh dashboard */ }

    dashboard[session.sessionId] = {
      mission: session.activeMission,
      title: session.title,
      status: session.status,
      agent: session.currentAgent,
      phase: session.currentPhase,
      bracket: session.contextBracket,
      promptCount: session.promptCount,
      tokens: session.tokens,
      cost: session.costUsd,
      lastUpdate: new Date().toISOString(),
    };

    await atomicWrite(dashboardPath, JSON.stringify(dashboard, null, 2));
  }
}
