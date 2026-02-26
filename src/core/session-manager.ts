import fs from 'fs/promises';
import path from 'path';
import type { SessionState, CrashInfo } from '../types/index.js';

export type { CrashInfo } from '../types/index.js';

const DEFAULT_STALE_HOURS = 168; // 7 days
const DEFAULT_CRASH_MINUTES = 30;

/**
 * Detect if a session likely crashed (inactive without PAUSE/COMPLETE).
 * @param crashMinutes — configurable threshold (default 30).
 */
export function detectCrashedSession(session: SessionState, crashMinutes: number = DEFAULT_CRASH_MINUTES): CrashInfo | null {
  if (['completed', 'paused', 'failed', 'idle'].includes(session.status)) {
    return null;
  }

  const lastActivity = session.lastActivity || session.startedAt;
  const elapsed = Date.now() - new Date(lastActivity).getTime();
  const minutes = Math.floor(elapsed / 60_000);

  if (minutes < crashMinutes) {
    return null;
  }

  return {
    sessionId: session.sessionId,
    lastActivity,
    minutesSinceActivity: minutes,
    lastPhase: session.currentPhase,
    lastAgent: session.currentAgent,
  };
}

/**
 * Generate a short title from the workflow/mission name.
 * Max 50 chars, cleans up common noise.
 */
export function generateSessionTitle(
  missionName: string,
  firstPhaseName?: string
): string {
  let title = missionName;

  if (firstPhaseName && title.length < 5) {
    title = `${title}: ${firstPhaseName}`;
  }

  if (title.length > 50) {
    title = title.slice(0, 47) + '...';
  }

  return title;
}

/**
 * Clean up session files older than maxAgeHours.
 * Fire-and-forget — never throws, never blocks.
 */
export async function cleanStaleSessions(
  sessionsDir: string,
  maxAgeHours: number = DEFAULT_STALE_HOURS
): Promise<number> {
  let cleaned = 0;
  try {
    const files = await fs.readdir(sessionsDir);
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(sessionsDir, file);

      try {
        const content = await fs.readFile(filePath, 'utf8');
        const session: SessionState = JSON.parse(content);

        if (!['completed', 'failed'].includes(session.status)) continue;

        const lastActivity = session.lastActivity || session.startedAt;
        const age = now - new Date(lastActivity).getTime();

        if (age > maxAgeMs) {
          await fs.unlink(filePath);
          cleaned++;
        }
      } catch { /* corrupt file */ }
    }
  } catch { /* no sessions dir */ }

  return cleaned;
}
