import { ConfigManager } from '../core/config.js';
import { PromptCompiler } from '../core/prompt-compiler.js';
import { createExecutor } from '../core/runner-executor.js';
import { hooks } from '../core/hooks.js';
import chalk from 'chalk';
import path from 'path';
import { errorMessage } from '../core/errors.js';

export const execCommand = async (agentId: string, taskId: string) => {
  const configManager = new ConfigManager();
  const compiler = new PromptCompiler();

  try {
    const config = await configManager.load();
    const sessionId = `exec-${agentId}-${Date.now()}`;

    console.log(chalk.blue(`\n  Executing: ${taskId} with @${agentId}...`));

    hooks.emit('session:start', {
      sessionId,
      agent: agentId,
      task: taskId,
      data: { workflowId: 'adhoc', activeMission: `Single Task: ${taskId}` }
    });

    const promptPath = await compiler.compile({
      agentId,
      taskId,
      module: 'sdlc',
      runner: config.project.runner,
    }, config);

    console.log(chalk.dim(`  Prompt: ${path.relative(process.cwd(), promptPath)}`));

    hooks.emit('step:start', {
      sessionId,
      agent: agentId,
      data: { stepName: taskId, task: taskId }
    });

    // Execute via runner
    const executor = await createExecutor(config.project.runner);

    if (executor.name === 'manual') {
      console.log(chalk.green(`\n  Prompt compiled. Execute manually:`));
      console.log(chalk.bold(`  ${promptPath}`));
      return;
    }

    console.log(chalk.dim(`  Runner: ${executor.name} — executing...`));
    const result = await executor.run(promptPath, process.cwd());

    const durationSec = (result.durationMs / 1000).toFixed(1);
    if (result.exitCode === 0) {
      console.log(chalk.green(`\n  Done in ${durationSec}s | tokens: ${result.tokensUsed} | cost: $${result.costUsd.toFixed(4)}`));
      if (result.output) {
        console.log(chalk.dim(`\n--- Output ---`));
        console.log(result.output.slice(0, 2000));
      }
    } else {
      console.log(chalk.red(`\n  Failed (exit ${result.exitCode}) after ${durationSec}s`));
      if (result.error) {
        console.log(chalk.red(`  ${result.error.slice(0, 300)}`));
      }
    }

    hooks.emit('step:complete', {
      sessionId,
      agent: agentId,
      data: { stepName: taskId, tokens: result.tokensUsed, cost: result.costUsd },
    });

  } catch (err) {
    console.error(chalk.red(`\n  Execution failed: ${errorMessage(err)}`));
  }
};
