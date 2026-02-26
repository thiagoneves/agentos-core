import { RunnerManager } from '../core/runner-manager.js';
import { ConfigManager } from '../core/config.js';
import chalk from 'chalk';
import { errorMessage } from '../core/errors.js';

export const syncCommand = async () => {
  const configManager = new ConfigManager();
  const runnerManager = new RunnerManager();

  try {
    const config = await configManager.load();

    console.log(chalk.blue(`\n  Syncing AgentOS with ${config.project.runner}...`));

    await runnerManager.sync(config);

    console.log(chalk.green('  + Runner instructions updated.'));
    console.log(chalk.green('  + Slash commands generated.'));
    console.log(chalk.green('  + Protocol file updated.'));
    console.log(chalk.bold.green('\n  Sync complete!'));
  } catch (err) {
    console.error(chalk.red(`\n  Sync failed: ${errorMessage(err)}`));
  }
};
