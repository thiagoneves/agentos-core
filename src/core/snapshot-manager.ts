import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class SnapshotManager {
  private agentosDir = path.join(process.cwd(), '.agentos');
  private snapshotsDir = path.join(this.agentosDir, 'snapshots');

  async createSnapshot(label: string = 'auto') {
    await fs.mkdir(this.snapshotsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotName = `${timestamp}-${label}`;
    const targetPath = path.join(this.snapshotsDir, snapshotName);

    await fs.mkdir(targetPath, { recursive: true });

    const dirsToBackup = ['state', 'memory', 'artifacts'];
    for (const dir of dirsToBackup) {
      const source = path.join(this.agentosDir, dir);
      try {
        await fs.access(source);
        await fs.cp(source, path.join(targetPath, dir), { recursive: true });
      } catch { /* dir may not exist */ }
    }

    const hash = await this.computeHash(targetPath);
    await fs.writeFile(path.join(targetPath, '.integrity'), hash, 'utf8');

    return snapshotName;
  }

  async listSnapshots() {
    try {
      const files = await fs.readdir(this.snapshotsDir);
      return files.filter(f => !f.startsWith('.')).sort().reverse();
    } catch {
      return [];
    }
  }

  async rollback(snapshotName: string) {
    const sourcePath = path.join(this.snapshotsDir, snapshotName);

    try {
      await fs.access(sourcePath);
    } catch {
      throw new Error(`Snapshot '${snapshotName}' not found.`);
    }

    await this.verifyIntegrity(sourcePath);

    const dirsToRestore = ['state', 'memory', 'artifacts'];
    for (const dir of dirsToRestore) {
      const source = path.join(sourcePath, dir);
      const target = path.join(this.agentosDir, dir);

      try {
        await fs.access(source);
        await fs.rm(target, { recursive: true, force: true });
        await fs.cp(source, target, { recursive: true });
      } catch { /* dir not in snapshot */ }
    }
  }

  private async verifyIntegrity(snapshotPath: string): Promise<void> {
    const integrityPath = path.join(snapshotPath, '.integrity');

    let savedHash: string;
    try {
      savedHash = (await fs.readFile(integrityPath, 'utf8')).trim();
    } catch {
      // Legacy snapshot without integrity file — allow rollback
      return;
    }

    const currentHash = await this.computeHash(snapshotPath);
    if (currentHash !== savedHash) {
      throw new Error(
        `Snapshot integrity check failed. Expected ${savedHash.slice(0, 16)}..., got ${currentHash.slice(0, 16)}... — snapshot may be corrupted.`
      );
    }
  }

  private async computeHash(dir: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const files = await this.collectFiles(dir);

    for (const file of files.sort()) {
      // Skip the integrity file itself
      if (path.basename(file) === '.integrity') continue;
      const content = await fs.readFile(file);
      hash.update(file.replace(dir, ''));
      hash.update(content);
    }

    return hash.digest('hex');
  }

  private async collectFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.collectFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  }
}
