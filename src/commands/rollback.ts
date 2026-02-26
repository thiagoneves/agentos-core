import inquirer from 'inquirer';
import chalk from 'chalk';
import { SnapshotManager } from '../core/snapshot-manager.js';
import { errorMessage } from '../core/errors.js';

export const rollbackCommand = async (snapshotName?: string) => {
  const manager = new SnapshotManager();

  try {
    const snapshots = await manager.listSnapshots();
    
    if (snapshots.length === 0) {
      console.log(chalk.yellow('\n[Warning] No snapshots available to rollback.'));
      return;
    }

    let targetSnapshot = snapshotName;

    if (!targetSnapshot) {
      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'snapshot',
          message: 'Select a snapshot to rollback to (WARNING: current state will be overwritten):',
          choices: snapshots
        }
      ]);
      targetSnapshot = answers.snapshot;
    }

    if (targetSnapshot) {
      console.log(chalk.yellow(`\n[⏪] Rolling back to snapshot: ${targetSnapshot}...`));
      await manager.rollback(targetSnapshot);
      console.log(chalk.bold.green('\n[✓] Rollback complete! State, Memory, and Artifacts restored.'));
    }
  } catch (err) {
    console.error(chalk.red(`\n[x] Rollback failed: ${errorMessage(err)}`));
  }
};
