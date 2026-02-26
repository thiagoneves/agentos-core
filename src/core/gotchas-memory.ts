import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import type { Gotcha } from '../types/index.js';
import { atomicWrite, withLock } from './atomic-fs.js';

export type { Gotcha } from '../types/index.js';

interface GotchasStore {
  /** Error patterns seen but not yet promoted to gotchas (< 3 occurrences) */
  pending: Record<string, { count: number; agent: string; domain: string; firstSeen: string; lastSeen: string }>;
  /** Confirmed gotchas (3+ occurrences of same error) */
  gotchas: Gotcha[];
}

const GOTCHA_THRESHOLD = 3;

export class GotchasMemory {
  private storePath: string;

  constructor(baseDir: string = process.cwd()) {
    this.storePath = path.join(baseDir, '.agentos', 'memory', 'gotchas.yaml');
  }

  private async load(): Promise<GotchasStore> {
    try {
      const content = await fs.readFile(this.storePath, 'utf8');
      return YAML.parse(content) || { pending: {}, gotchas: [] };
    } catch {
      return { pending: {}, gotchas: [] };
    }
  }

  private async save(store: GotchasStore): Promise<void> {
    await atomicWrite(this.storePath, YAML.stringify(store));
  }

  /**
   * Normalize error message to a stable pattern key.
   * Keeps file basenames and line numbers for context, strips only volatile parts.
   */
  private normalizeError(error: string): string {
    return error
      .replace(/(?:\/[\w\-./]+\/)([\w\-.]+\.\w+)/g, '$1')  // full paths → basename only
      .replace(/\b0x[0-9a-fA-F]+\b/g, '<hex>')              // hex addresses
      .replace(/\b\d{6,}\b/g, '<num>')                       // only very large numbers (6+ digits)
      .trim()
      .slice(0, 200);
  }

  /**
   * Record an error. If the same pattern occurs 3+ times, it becomes a gotcha.
   */
  async recordError(error: string, agent: string, domain: string = 'general'): Promise<Gotcha | null> {
    return withLock(this.storePath, async () => {
    const store = await this.load();
    const pattern = this.normalizeError(error);
    const now = new Date().toISOString();

    const existing = store.gotchas.find(g => g.pattern === pattern);
    if (existing) {
      existing.occurrences++;
      existing.lastSeen = now;
      await this.save(store);
      return existing;
    }

    if (!store.pending[pattern]) {
      store.pending[pattern] = { count: 0, agent, domain, firstSeen: now, lastSeen: now };
    }
    store.pending[pattern].count++;
    store.pending[pattern].lastSeen = now;

    // Promote to gotcha at threshold
    if (store.pending[pattern].count >= GOTCHA_THRESHOLD) {
      const pending = store.pending[pattern];
      const gotcha: Gotcha = {
        pattern,
        message: error.trim().slice(0, 300),
        agent,
        domain,
        occurrences: pending.count,
        firstSeen: pending.firstSeen,
        lastSeen: now,
      };
      store.gotchas.push(gotcha);
      delete store.pending[pattern];
      await this.save(store);
      return gotcha;
    }

    await this.save(store);
    return null;
    });
  }

  /**
   * Get relevant gotchas for a given agent/domain.
   * Returns a compact string suitable for prompt injection.
   */
  async getRelevantGotchas(agent: string, domain?: string): Promise<string> {
    const store = await this.load();
    if (store.gotchas.length === 0) return '';

    const relevant = store.gotchas.filter(g =>
      g.agent === agent || g.domain === domain || g.domain === 'general'
    );

    if (relevant.length === 0) return '';

    const lines = relevant
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 5) // max 5 gotchas to keep token cost minimal
      .map(g => `- ${g.message} (seen ${g.occurrences}x)`);

    return lines.join('\n');
  }
}
