import chalk from 'chalk';
import { ModuleManager } from '../core/module-manager.js';
import { RunnerManager } from '../core/runner-manager.js';
import { ConfigManager } from '../core/config.js';
import { errorMessage } from '../core/errors.js';

export const moduleListCommand = async () => {
  const manager = new ModuleManager();

  try {
    const installed = await manager.listInstalled();
    if (installed.length === 0) {
      console.log(chalk.dim('\n  No modules installed. Use `aos install <source>` to add one.\n'));
      return;
    }

    console.log(chalk.bold.blue('\n  Installed Modules:\n'));
    for (const mod of installed) {
      console.log(`  ${chalk.green(mod.name)} v${mod.version} — ${mod.description}`);
    }
    console.log();
  } catch (err) {
    console.error(chalk.red(`[AgentOS] Failed to list modules: ${errorMessage(err)}`));
  }
};

export const moduleRemoveCommand = async (name: string) => {
  const manager = new ModuleManager();
  const configManager = new ConfigManager();
  const runnerManager = new RunnerManager();

  try {
    await manager.remove(name);

    // Re-sync runner integration
    const config = await configManager.load();
    await runnerManager.sync(config);
    console.log(chalk.green('  Runner integration updated.'));
  } catch (err) {
    console.error(chalk.red(`[AgentOS] ${errorMessage(err)}`));
  }
};
