import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import chalk from 'chalk';
import YAML from 'yaml';
import { ConfigManager } from './config.js';
import { RegistryClient } from './registry-client.js';
import { ModuleManifest, ModuleManifestSchema, ManifestLock } from '../types/index.js';

const execAsync = promisify(exec);

interface AvailableModule {
  name: string;
  description: string;
  builtin: boolean;
}

export class ModuleManager {
  private agentosDir: string;
  private modulesDir: string;
  private builtinDir: string;
  private configManager: ConfigManager;
  private _registryClient: RegistryClient | null = null;

  constructor(baseDir: string = process.cwd()) {
    this.agentosDir = path.join(baseDir, '.agentos');
    this.modulesDir = path.join(this.agentosDir, 'modules');
    this.builtinDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'modules');
    this.configManager = new ConfigManager(baseDir);
  }

  private async getRegistryClient(): Promise<RegistryClient> {
    if (!this._registryClient) {
      let registryUrl: string | undefined;
      try {
        const config = await this.configManager.load();
        registryUrl = config.registry?.url;
      } catch {
        // Config may not exist yet (during init)
      }
      this._registryClient = new RegistryClient({
        registryUrl,
        agentosDir: this.agentosDir,
      });
    }
    return this._registryClient;
  }

  async getAvailableModules(): Promise<AvailableModule[]> {
    try {
      const client = await this.getRegistryClient();
      const registry = await client.fetchRegistry();
      return Object.entries(registry.modules).map(([name, mod]) => ({
        name,
        description: mod.description,
        builtin: false,
      }));
    } catch {
      // Registry unavailable — fall through to builtin then hardcoded fallback
    }

    const modules: AvailableModule[] = [];
    try {
      const dirs = await fs.readdir(this.builtinDir);
      for (const dir of dirs) {
        const manifestPath = path.join(this.builtinDir, dir, 'module.yaml');
        try {
          const content = await fs.readFile(manifestPath, 'utf8');
          const manifest = YAML.parse(content);
          modules.push({
            name: manifest.name || dir,
            description: manifest.description || 'No description',
            builtin: true,
          });
        } catch { /* invalid module */ }
      }
    } catch { /* no builtin dir */ }

    // Hardcoded fallback so `agentos init` works even without network or builtins
    if (modules.length === 0) {
      return [
        { name: 'sdlc', description: 'Complete Software Development Lifecycle', builtin: true },
      ];
    }

    return modules;
  }

  async install(source: string): Promise<string> {
    let sourcePath: string;
    let moduleName: string;

    if (source.startsWith('github:')) {
      const repo = source.replace('github:', '');
      if (!/^[\w\-]+\/[\w\-]+$/.test(repo)) {
        throw new Error(`Invalid GitHub source '${repo}'. Expected format: github:user/repo`);
      }
      const tmpDir = path.join(this.agentosDir, '.tmp', repo.replace('/', '-'));
      await fs.mkdir(path.dirname(tmpDir), { recursive: true });
      await fs.rm(tmpDir, { recursive: true, force: true });

      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(chalk.blue(`  Cloning ${repo}${attempt > 1 ? ` (attempt ${attempt}/${maxRetries})` : ''}...`));
          await execAsync(`git clone --depth 1 https://github.com/${repo}.git "${tmpDir}"`, { timeout: 60_000 });
          break;
        } catch (err) {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch((e) => {
            if (process.env.DEBUG) console.error(`Cleanup failed for ${tmpDir}: ${e instanceof Error ? e.message : e}`);
          });
          if (attempt === maxRetries) {
            await fs.rm(path.join(this.agentosDir, '.tmp'), { recursive: true, force: true }).catch((e) => {
              if (process.env.DEBUG) console.error(`Cleanup failed for .tmp: ${e instanceof Error ? e.message : e}`);
            });
            throw new Error(`Failed to clone '${repo}' after ${maxRetries} attempts: ${err instanceof Error ? err.message : String(err)}`);
          }
          const backoffMs = 1000 * Math.pow(2, attempt - 1);
          console.log(chalk.yellow(`  Clone failed, retrying in ${backoffMs / 1000}s...`));
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }

      sourcePath = tmpDir;
      moduleName = await this.resolveModuleName(tmpDir);
    } else if (source.startsWith('./') || source.startsWith('/')) {
      sourcePath = path.resolve(source);
      moduleName = await this.resolveModuleName(sourcePath);
    } else {
      // Bare name: try builtin first, then remote registry
      moduleName = source;
      const builtinPath = path.join(this.builtinDir, source);

      let useBuiltin = false;
      try {
        await fs.access(builtinPath);
        useBuiltin = true;
      } catch { /* not a builtin */ }

      if (useBuiltin) {
        sourcePath = builtinPath;
      } else {
        const client = await this.getRegistryClient();
        const tmpDir = path.join(this.agentosDir, '.tmp', `registry-${source}`);
        await fs.rm(tmpDir, { recursive: true, force: true });
        await fs.mkdir(tmpDir, { recursive: true });

        await client.downloadModule(source, tmpDir);
        sourcePath = tmpDir;
        moduleName = await this.resolveModuleName(tmpDir);
      }
    }

    const preManifest = await this.loadManifest(sourcePath).catch(() => null);
    if (preManifest && preManifest.depends_on.length > 0) {
      const installed = await this.listInstalled();
      const installedNames = new Set(installed.map(m => m.name));
      const missing = preManifest.depends_on.filter(d => !installedNames.has(d.name));
      if (missing.length > 0) {
        throw new Error(
          `Module '${moduleName}' requires: ${missing.map(d => d.name).join(', ')}. Install them first.`
        );
      }
    }

    console.log(chalk.blue(`  Installing module: ${moduleName}...`));

    const targetPath = path.join(this.modulesDir, moduleName);
    await fs.mkdir(this.modulesDir, { recursive: true });
    await fs.rm(targetPath, { recursive: true, force: true });
    await this.copyModule(sourcePath, targetPath);

    const manifest = await this.loadManifest(targetPath);
    console.log(chalk.green(`  Module '${manifest.name}' v${manifest.version} installed.`));

    const config = await this.configManager.load();
    const existing = config.modules.installed.findIndex(m => m.name === moduleName);
    const moduleInfo = {
      name: moduleName,
      version: manifest.version,
      source: source.startsWith('github:') ? 'github' as const :
              source.startsWith('./') || source.startsWith('/') ? 'local' as const :
              'registry' as const,
    };

    if (existing >= 0) {
      config.modules.installed[existing] = moduleInfo;
    } else {
      config.modules.installed.push(moduleInfo);
    }
    await this.configManager.update({ modules: config.modules });
    await this.updateLock(moduleName, manifest, source);

    const tmpDir = path.join(this.agentosDir, '.tmp');
    await fs.rm(tmpDir, { recursive: true, force: true }).catch((e) => {
      if (process.env.DEBUG) console.error(`Cleanup failed for tmp: ${e instanceof Error ? e.message : e}`);
    });

    return moduleName;
  }

  async remove(moduleName: string): Promise<void> {
    const targetPath = path.join(this.modulesDir, moduleName);
    try {
      await fs.access(targetPath);
    } catch {
      throw new Error(`Module '${moduleName}' is not installed.`);
    }

    await fs.rm(targetPath, { recursive: true, force: true });

    const config = await this.configManager.load();
    config.modules.installed = config.modules.installed.filter(m => m.name !== moduleName);
    await this.configManager.update({ modules: config.modules });

    console.log(chalk.green(`  Module '${moduleName}' removed.`));
  }

  async listInstalled(): Promise<ModuleManifest[]> {
    const modules: ModuleManifest[] = [];
    try {
      const dirs = await fs.readdir(this.modulesDir);
      for (const dir of dirs) {
        try {
          const manifest = await this.loadManifest(path.join(this.modulesDir, dir));
          modules.push(manifest);
        } catch { /* invalid module */ }
      }
    } catch { /* no modules dir */ }
    return modules;
  }

  async loadManifest(modulePath: string): Promise<ModuleManifest> {
    for (const filename of ['module.yaml', 'pack.yaml']) {
      const manifestPath = path.join(modulePath, filename);
      try {
        const content = await fs.readFile(manifestPath, 'utf8');
        const raw = YAML.parse(content);
        const data = raw.pack || raw; // pack.yaml wraps content under a 'pack' key
        return ModuleManifestSchema.parse(data);
      } catch { /* try next */ }
    }
    throw new Error(`No valid module.yaml found in ${modulePath}`);
  }

  private async resolveModuleName(sourcePath: string): Promise<string> {
    try {
      const manifest = await this.loadManifest(sourcePath);
      return manifest.name;
    } catch {
      return path.basename(sourcePath);
    }
  }

  private async copyModule(source: string, target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;

      const srcPath = path.join(source, entry.name);
      const destPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        await this.copyModule(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  private async updateLock(name: string, manifest: ModuleManifest, source: string): Promise<void> {
    const lockPath = path.join(this.agentosDir, 'manifest.lock');
    let lock: ManifestLock;

    try {
      const content = await fs.readFile(lockPath, 'utf8');
      lock = YAML.parse(content);
    } catch {
      lock = { version: '1.0', generated: new Date().toISOString(), modules: {} };
    }

    lock.modules[name] = {
      version: manifest.version,
      source,
      integrity: await this.computeIntegrity(path.join(this.modulesDir, name)),
      installed: new Date().toISOString(),
    };
    lock.generated = new Date().toISOString();

    await fs.writeFile(lockPath, YAML.stringify(lock), 'utf8');
  }

  private async computeIntegrity(dir: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const files = await this.collectFiles(dir);
    for (const file of files.sort()) {
      const content = await fs.readFile(file);
      hash.update(file.replace(dir, ''));
      hash.update(content);
    }
    return `sha256:${hash.digest('hex').substring(0, 16)}`;
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
