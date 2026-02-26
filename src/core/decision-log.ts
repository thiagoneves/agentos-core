import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { hooks } from './hooks.js';
import { atomicWrite, withLock } from './atomic-fs.js';

export interface Decision {
  id: string;
  timestamp: string;
  title: string;
  context: string;
  decision: string;
  alternatives?: string[];
  agent: string;
  sessionId: string;
  phase?: string;
}

export class DecisionLog {
  private logPath: string;

  constructor(baseDir: string = process.cwd()) {
    this.logPath = path.join(baseDir, '.agentos', 'state', 'decisions.yaml');
  }

  async record(entry: Omit<Decision, 'id' | 'timestamp'>): Promise<Decision> {
    return withLock(this.logPath, async () => {
      const decisions = await this.list();

      const decision: Decision = {
        ...entry,
        id: `DEC-${String(decisions.length + 1).padStart(3, '0')}`,
        timestamp: new Date().toISOString(),
      };

      decisions.push(decision);

      await atomicWrite(this.logPath, YAML.stringify({ decisions }));

      hooks.emit('decision:recorded', {
        sessionId: decision.sessionId,
        agent: decision.agent,
        data: { title: decision.title, id: decision.id },
      });

      return decision;
    });
  }

  async list(): Promise<Decision[]> {
    try {
      const content = await fs.readFile(this.logPath, 'utf8');
      const parsed = YAML.parse(content);
      return Array.isArray(parsed?.decisions) ? parsed.decisions : [];
    } catch {
      return [];
    }
  }

  async findBySession(sessionId: string): Promise<Decision[]> {
    const all = await this.list();
    return all.filter(d => d.sessionId === sessionId);
  }

  async findByAgent(agent: string): Promise<Decision[]> {
    const all = await this.list();
    const normalized = agent.replace(/^@/, '').toLowerCase();
    return all.filter(d => d.agent.replace(/^@/, '').toLowerCase() === normalized);
  }
}
