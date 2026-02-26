import { ModuleManager } from '../core/module-manager.js';
import { RunnerManager } from '../core/runner-manager.js';
import { ConfigManager } from '../core/config.js';
import chalk from 'chalk';
import { errorMessage } from '../core/errors.js';

export const installCommand = async (source: string) => {
  const configManager = new ConfigManager();
  const moduleManager = new ModuleManager();
  const runnerManager = new RunnerManager();

  try {
    const moduleName = await moduleManager.install(source);
    console.log(chalk.green(`  Module '${moduleName}' installed successfully.`));

    // Re-sync runner integration to include new module
    const config = await configManager.load();
    await runnerManager.sync(config);
    console.log(chalk.green('  Runner integration updated.'));
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${errorMessage(err)}`));
  }
};
