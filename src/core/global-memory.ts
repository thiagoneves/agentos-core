import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';

export interface GlobalMemory {
  preferences: {
    default_language?: string;
    preferred_stack?: string[];
    default_runner?: string;
    git_auto_commit?: boolean;
  };
  known_modules: string[];
}

export class GlobalMemoryManager {
  private globalDir = path.join(os.homedir(), '.agentos');
  private globalFile = path.join(this.globalDir, 'global.yaml');

  async load(): Promise<GlobalMemory> {
    try {
      const content = await fs.readFile(this.globalFile, 'utf8');
      return YAML.parse(content);
    } catch {
      return {
        preferences: {},
        known_modules: []
      };
    }
  }

  async save(memory: GlobalMemory) {
    await fs.mkdir(this.globalDir, { recursive: true });
    await fs.writeFile(this.globalFile, YAML.stringify(memory), 'utf8');
  }

  async updatePreferences(update: Partial<GlobalMemory['preferences']>) {
    const mem = await this.load();
    mem.preferences = { ...mem.preferences, ...update };
    await this.save(mem);
  }

  async recordModuleUsage(moduleName: string) {
    const mem = await this.load();
    if (!mem.known_modules.includes(moduleName)) {
      mem.known_modules.push(moduleName);
      await this.save(mem);
    }
  }
}
