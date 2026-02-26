import fs from 'fs/promises';
import path from 'path';
import { SessionMetrics } from './dashboard.js';

export class Summarizer {
  private agentosDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.agentosDir = path.join(baseDir, '.agentos');
  }

  async summarizeSession(session: SessionMetrics): Promise<string> {
    const summaryPath = path.join(this.agentosDir, 'memory', 'summaries', `${session.sessionId}.md`);
    
    if (session.events.length === 0) return 'No previous activity in this session.';

    let summary = `# Session Summary: ${session.activeMission}\n\n`;
    summary += `**Status:** ${session.status} | **Tokens:** ${session.tokens}\n\n`;
    summary += `## Accomplishments\n`;

    const completedSteps = session.events.filter(e => e.type === 'STEP_COMPLETE');
    for (const step of completedSteps) {
      summary += `- **${step.agent}** completed phase **${step.data?.stepName || 'unknown'}**.\n`;
      if (step.data?.artifact) {
        summary += `  - Created: \`${step.data.artifact}\`\n`;
      }
    }

    summary += `\n## Current State\nCurrently at phase **${session.currentPhase}** with agent **@${session.currentAgent}**.\n`;

    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, summary, 'utf8');

    return summary;
  }

  async getLatestSummary(sessionId: string): Promise<string | null> {
    const summaryPath = path.join(this.agentosDir, 'memory', 'summaries', `${sessionId}.md`);
    try {
      return await fs.readFile(summaryPath, 'utf8');
    } catch {
      return null;
    }
  }
}
