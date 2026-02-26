#!/usr/bin/env node

/**
 * AgentOS Context Window Monitor
 *
 * Claude Code PostToolUse hook that monitors context window usage
 * and injects warnings when running low to prevent "context rot".
 *
 * Thresholds:
 *   WARNING  — ≤35% remaining → wrap up current task
 *   CRITICAL — ≤25% remaining → stop and save state immediately
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONTEXT_WINDOW_SIZE = 200000;
const WARNING_THRESHOLD = 35;  // % remaining
const CRITICAL_THRESHOLD = 25; // % remaining
const DEBOUNCE_COUNT = 5;      // tool uses between warnings

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    // Invalid input — exit silently, never block tool execution
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  const sessionId = hookData.session_id || 'unknown';
  const transcriptPath = hookData.transcript_path;

  // Read context usage from transcript
  let usedTokens = 0;
  if (transcriptPath) {
    try {
      const content = fs.readFileSync(transcriptPath, 'utf8');
      const lines = content.trim().split('\n');

      // Parse from the end to find the most recent usage stats
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          const usage = entry.message?.usage || entry.usage;
          if (usage) {
            usedTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
            break;
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* transcript not readable */ }
  }

  if (usedTokens === 0) {
    // No usage data available — exit silently
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  const usedPct = Math.round((usedTokens / CONTEXT_WINDOW_SIZE) * 100);
  const remainingPct = 100 - usedPct;

  // Write metrics to bridge file for dashboard
  const metricsPath = path.join(os.tmpdir(), `agentos-ctx-${sessionId}.json`);
  try {
    fs.writeFileSync(metricsPath, JSON.stringify({
      sessionId,
      usedTokens,
      usedPct,
      remainingPct,
      contextWindowSize: CONTEXT_WINDOW_SIZE,
      timestamp: new Date().toISOString(),
    }), 'utf8');
  } catch { /* non-critical */ }

  // Debounce: check counter file
  const counterPath = path.join(os.tmpdir(), `agentos-ctx-counter-${sessionId}`);
  let counter = 0;
  let lastSeverity = '';
  try {
    const data = JSON.parse(fs.readFileSync(counterPath, 'utf8'));
    counter = data.counter || 0;
    lastSeverity = data.severity || '';
  } catch { /* first run */ }

  counter++;

  // Determine severity
  let severity = '';
  if (remainingPct <= CRITICAL_THRESHOLD) {
    severity = 'critical';
  } else if (remainingPct <= WARNING_THRESHOLD) {
    severity = 'warning';
  }

  // Save counter state
  try {
    fs.writeFileSync(counterPath, JSON.stringify({ counter, severity }), 'utf8');
  } catch { /* non-critical */ }

  // Check if we should inject a warning
  if (!severity) {
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  // Debounce: only warn every N tool uses (severity escalation bypasses debounce)
  const escalated = severity === 'critical' && lastSeverity !== 'critical';
  if (counter % DEBOUNCE_COUNT !== 0 && !escalated) {
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  // Inject warning
  let message = '';
  if (severity === 'critical') {
    message = [
      `[AgentOS] CRITICAL: Context window at ${usedPct}% (${remainingPct}% remaining).`,
      'STOP new work immediately. Save state NOW.',
      'Run: `aos pause` to generate a handoff file for session continuity.',
      'Do NOT start new complex tasks — quality will degrade.',
    ].join(' ');
  } else {
    message = [
      `[AgentOS] WARNING: Context window at ${usedPct}% (${remainingPct}% remaining).`,
      'Begin wrapping up your current task.',
      'Do not start new complex work.',
      'If you need to stop, run: `aos pause` to save state.',
    ].join(' ');
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: message,
    },
  }));
  process.exit(0);
}

main().catch(() => {
  // Never crash — exit silently
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
});
