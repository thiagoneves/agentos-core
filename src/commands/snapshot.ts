import { SnapshotManager } from '../core/snapshot-manager.js';
import chalk from 'chalk';
import { errorMessage } from '../core/errors.js';

export const snapshotCommand = async (action: string, options: { label?: string }) => {
  const manager = new SnapshotManager();

  try {
    if (action === 'save') {
      console.log(chalk.blue('\n[📸] Creating snapshot...'));
      const label = options.label || 'manual';
      const name = await manager.createSnapshot(label);
      console.log(chalk.green(`  ✓ Snapshot saved: ${name}`));
    } else if (action === 'list') {
      const snapshots = await manager.listSnapshots();
      console.log(chalk.bold.blue('\n[📸] Available Snapshots:'));
      if (snapshots.length === 0) {
        console.log(chalk.dim('  No snapshots found.'));
      } else {
        snapshots.forEach(s => console.log(`  - ${s}`));
      }
    } else {
      console.error(chalk.red(`\n[x] Unknown action: ${action}. Use 'save' or 'list'.`));
    }
  } catch (err) {
    console.error(chalk.red(`\n[x] Snapshot failed: ${errorMessage(err)}`));
  }
};
