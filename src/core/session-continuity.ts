import fs from 'fs/promises';
import path from 'path';
import { SessionState, WorkflowDefinition } from '../types/index.js';

const CONTINUE_FILE = '.handoff.md';

function formatDuration(startTs: string, endTs: string): string {
  const ms = new Date(endTs).getTime() - new Date(startTs).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

export async function generateContinueHere(
  session: SessionState,
  workflow: WorkflowDefinition,
  agentosDir: string,
  reason: string = 'paused'
): Promise<string> {
  const events = session.events || [];
  const phases = workflow.phases;

  const completedPhases = events
    .filter(e => e.type === 'PHASE_COMPLETE' || (e.type === 'STEP_COMPLETE' && e.data?.status === 'completed'))
    .map(e => e.phase || e.data?.step)
    .filter(Boolean);

  const completedLines: string[] = [];
  for (const phase of phases) {
    if (completedPhases.includes(phase.id)) {
      const startEv = events.find(e => e.type === 'PHASE_START' && e.phase === phase.id);
      const endEv = events.find(e =>
        (e.type === 'PHASE_COMPLETE' || e.type === 'STEP_COMPLETE') &&
        (e.phase === phase.id || e.data?.step === phase.id)
      );
      const dur = startEv && endEv ? ` — ${formatDuration(startEv.timestamp, endEv.timestamp)}` : '';
      completedLines.push(`- [x] ${phase.id} (by @${phase.agent})${dur}`);
    }
  }

  const remainingPhases = phases.filter(p => !completedPhases.includes(p.id));
  const remainingLines = remainingPhases.map(p => `- [ ] ${p.name} (by @${p.agent})`);

  const currentPhase = phases.find(p => p.id === session.currentPhase);

  // Find last compiled prompt for context
  let lastPromptHint = '';
  const compiledDir = path.join(agentosDir, 'compiled');
  try {
    const files = await fs.readdir(compiledDir);
    const sorted = files.filter(f => f.endsWith('.prompt.md')).sort().reverse();
    if (sorted[0]) {
      lastPromptHint = `Read the compiled prompt at \`.agentos/compiled/${sorted[0]}\`.`;
    }
  } catch { /* no compiled dir */ }

  const content = `---
session_id: ${session.sessionId}
workflow: ${session.workflowId}
phase: ${session.currentPhase}
agent: ${session.currentAgent}
timestamp: ${new Date().toISOString()}
reason: ${reason}
---

# Session Handoff

## Completed
${completedLines.length > 0 ? completedLines.join('\n') : '(none yet)'}

## Current
- Phase: ${session.currentPhase} (by @${session.currentAgent})
- Status: ${reason}
- Mission: ${session.activeMission}

## Remaining
${remainingLines.length > 0 ? remainingLines.join('\n') : '(all phases completed)'}

## Metrics
- Tokens: ${session.tokens}
- Cost: $${session.costUsd.toFixed(4)}
- Events: ${events.length}

## Next Action
${currentPhase
    ? `Resume phase "${currentPhase.name}" with agent @${currentPhase.agent}, task: ${currentPhase.task}. ${lastPromptHint}`
    : `All phases completed. Run: \`aos report --step "Done" --status completed\``
}
`;

  const stateDir = path.join(agentosDir, 'state');
  await fs.mkdir(stateDir, { recursive: true });
  const filePath = path.join(stateDir, CONTINUE_FILE);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

export async function consumeContinueHere(agentosDir: string): Promise<string | null> {
  const filePath = path.join(agentosDir, 'state', CONTINUE_FILE);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content;
  } catch {
    return null;
  }
}

export async function deleteContinueHere(agentosDir: string): Promise<void> {
  const filePath = path.join(agentosDir, 'state', CONTINUE_FILE);
  try {
    await fs.unlink(filePath);
  } catch { /* file doesn't exist */ }
}
