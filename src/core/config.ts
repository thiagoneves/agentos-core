import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { AgentOSConfig, AgentOSConfigSchema } from '../types/index.js';
import { atomicWrite, withLock } from './atomic-fs.js';

export class ConfigManager {
  public configPath: string;
  public agentosDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.agentosDir = path.join(baseDir, '.agentos');
    this.configPath = path.join(this.agentosDir, 'config.yaml');
  }

  async init(data: Partial<AgentOSConfig>): Promise<AgentOSConfig> {
    await fs.mkdir(this.agentosDir, { recursive: true });

    const config = AgentOSConfigSchema.parse({
      version: '1.0',
      project: {
        name: data.project?.name || path.basename(path.dirname(this.agentosDir)),
        state: data.project?.state || 'brownfield',
        output_language: data.project?.output_language || 'English',
        runner: data.project?.runner || 'Auto-detect',
      },
      engineering: {
        stack: data.engineering?.stack || [],
        testing_policy: data.engineering?.testing_policy || 'post',
        autonomy: data.engineering?.autonomy || 'balanced',
        commit_pattern: data.engineering?.commit_pattern || 'conventional',
      },
      modules: {
        installed: data.modules?.installed || [],
      },
      settings: {
        tokens: {
          context_budget: data.settings?.tokens?.context_budget || '50%',
          summary_max_lines: data.settings?.tokens?.summary_max_lines || 50,
          index_enabled: data.settings?.tokens?.index_enabled ?? true,
        },
        git: {
          auto_commit: data.settings?.git?.auto_commit ?? true,
          commit_prefix: data.settings?.git?.commit_prefix || 'aos',
        },
      },
    });

    await atomicWrite(this.configPath, YAML.stringify(config));
    return config;
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<AgentOSConfig> {
    const content = await fs.readFile(this.configPath, 'utf8');
    const raw = YAML.parse(content);
    return AgentOSConfigSchema.parse(raw);
  }

  async update(patch: Partial<AgentOSConfig>): Promise<AgentOSConfig> {
    return withLock(this.configPath, async () => {
    const current = await this.load();
    const merged = {
      ...current,
      ...patch,
      project: { ...current.project, ...patch.project },
      engineering: { ...current.engineering, ...patch.engineering },
      modules: patch.modules || current.modules,
      settings: {
        tokens: { ...current.settings.tokens, ...patch.settings?.tokens },
        git: { ...current.settings.git, ...patch.settings?.git },
        session: { ...current.settings.session, ...patch.settings?.session },
      },
      registry: { ...current.registry, ...patch.registry },
    };
    const config = AgentOSConfigSchema.parse(merged);
    await atomicWrite(this.configPath, YAML.stringify(config));
    return config;
    });
  }
}
