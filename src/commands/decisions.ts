import chalk from 'chalk';
import { DecisionLog } from '../core/decision-log.js';

export const decisionsCommand = async (options: { session?: string; agent?: string }) => {
  const log = new DecisionLog();

  let decisions = await log.list();

  if (options.session) {
    decisions = decisions.filter(d => d.sessionId === options.session);
  }
  if (options.agent) {
    const normalized = options.agent.replace(/^@/, '').toLowerCase();
    decisions = decisions.filter(d => d.agent.replace(/^@/, '').toLowerCase() === normalized);
  }

  if (decisions.length === 0) {
    console.log(chalk.dim('\n  No decisions recorded yet.\n'));
    return;
  }

  console.log(chalk.bold(`\n  Decision Log (${decisions.length} entries)\n`));

  for (const d of decisions) {
    const date = new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const time = new Date(d.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

    console.log(`  ${chalk.blue(d.id)} ${chalk.dim(`${date} ${time}`)} ${chalk.bold(d.title)}`);
    console.log(`  ${chalk.dim('Agent:')} @${d.agent}${d.phase ? chalk.dim(` | Phase: ${d.phase}`) : ''}`);
    console.log(`  ${chalk.dim('Context:')} ${d.context}`);
    console.log(`  ${chalk.green('Decision:')} ${d.decision}`);
    if (d.alternatives && d.alternatives.length > 0) {
      console.log(`  ${chalk.dim('Alternatives:')} ${d.alternatives.join(', ')}`);
    }
    console.log();
  }
};
