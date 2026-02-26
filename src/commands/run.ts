import { ConfigManager } from '../core/config.js';
import { WorkflowEngine } from '../core/workflow-engine.js';
import chalk from 'chalk';
import { errorMessage } from '../core/errors.js';

export const runCommand = async (workflowId: string, options?: { resume?: string }) => {
  const configManager = new ConfigManager();
  const engine = new WorkflowEngine();

  try {
    const config = await configManager.load();

    if (options?.resume) {
      console.log(chalk.blue(`\n  Resuming session: ${options.resume}...`));
      await engine.resume(options.resume, config);
      return;
    }

    console.log(chalk.blue(`\n  Starting workflow: ${workflowId}...`));
    const sessionId = await engine.start(workflowId, config);

    console.log(chalk.green(`\n  Session: ${sessionId}`));
    console.log(chalk.dim(`  Monitor: .agentos/state/sessions/${sessionId}.json`));
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${errorMessage(err)}`));
  }
};
