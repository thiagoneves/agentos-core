import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import type { ArtifactInfo } from '../types/index.js';

export type { ArtifactInfo } from '../types/index.js';

export class ArtifactManager {
  private agentosDir: string;
  private indexPath: string;
  private artifactsDir: string;
  private lastSyncHash: string = '';

  constructor(baseDir: string = process.cwd()) {
    this.agentosDir = path.join(baseDir, '.agentos');
    this.indexPath = path.join(this.agentosDir, 'memory', 'index.yaml');
    this.artifactsDir = path.join(this.agentosDir, 'artifacts');
  }

  async syncIndex() {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.mkdir(this.artifactsDir, { recursive: true });

    const files = await fs.readdir(this.artifactsDir);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort();

    // Quick mtime check — skip re-indexing if nothing changed
    const stats = await Promise.all(
      mdFiles.map(f => fs.stat(path.join(this.artifactsDir, f)))
    );
    const hash = mdFiles.map((f, i) => `${f}:${stats[i].mtimeMs}`).join('|');

    if (hash === this.lastSyncHash) return;

    const index: Record<string, ArtifactInfo> = {};

    for (let i = 0; i < mdFiles.length; i++) {
      const file = mdFiles[i];
      const fullPath = path.join(this.artifactsDir, file);
      const content = await fs.readFile(fullPath, 'utf8');

      const firstLine = content.split('\n')[0] || '';
      const summary = firstLine.replace('#', '').trim() || 'No description';

      index[file] = {
        path: 'artifacts/' + file,
        name: file,
        summary,
        lastUpdated: stats[i].mtime.toISOString(),
        size: stats[i].size,
      };
    }

    await fs.writeFile(this.indexPath, YAML.stringify({ version: '1.0', artifacts: index }), 'utf8');
    this.lastSyncHash = hash;
  }

  async getIndexContent(): Promise<string> {
    try {
      return await fs.readFile(this.indexPath, 'utf8');
    } catch {
      return 'No artifact index found.';
    }
  }
}
