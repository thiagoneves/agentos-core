import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { WorkflowDefinition, WorkflowDefinitionSchema, AgentOSConfig } from '../types/index.js';

export class WorkflowLoader {
  private agentosDir: string;

  constructor(agentosDir: string) {
    this.agentosDir = agentosDir;
  }

  async load(id: string, module: string): Promise<WorkflowDefinition> {
    for (const ext of ['.yaml', '.yml', '.md']) {
      const filePath = path.join(this.agentosDir, 'modules', module, 'workflows', `${id}${ext}`);
      try {
        const content = await fs.readFile(filePath, 'utf8');

        if (ext === '.md') {
          return this.parseMarkdown(content, id);
        }

        const raw = YAML.parse(content);

        if (raw.workflow && raw.phases) {
          return WorkflowDefinitionSchema.parse(raw);
        }
        if (raw.phases) {
          return WorkflowDefinitionSchema.parse({
            workflow: { id: raw.id || id, name: raw.name || id },
            phases: raw.phases,
            flow: raw.flow,
          });
        }

        throw new Error(`Unknown workflow format in ${filePath}`);
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
    }

    throw new Error(`Workflow '${id}' not found in module '${module}'.`);
  }

  async list(config: AgentOSConfig): Promise<{ module: string; id: string; name: string }[]> {
    const results: { module: string; id: string; name: string }[] = [];
    const modules = config.modules.installed;

    for (const mod of modules) {
      const wfDir = path.join(this.agentosDir, 'modules', mod.name, 'workflows');
      try {
        const files = await fs.readdir(wfDir);
        for (const file of files) {
          const ext = path.extname(file);
          if (['.yaml', '.yml', '.md'].includes(ext)) {
            const id = path.basename(file, ext);
            try {
              const wf = await this.load(id, mod.name);
              results.push({ module: mod.name, id, name: wf.workflow.name });
            } catch (err) {
              if (process.env.DEBUG) console.error(`Skip invalid workflow ${file} in ${mod.name}: ${err instanceof Error ? err.message : err}`);
            }
          }
        }
      } catch (err) {
        if (process.env.DEBUG) console.error(`No workflows dir for ${mod.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return results;
  }

  private parseMarkdown(content: string, id: string): WorkflowDefinition {
    const parts = content.split('---');
    if (parts.length < 3) {
      throw new Error(`Invalid workflow markdown: missing frontmatter.`);
    }
    const frontmatter = YAML.parse(parts[1] || '');
    return WorkflowDefinitionSchema.parse({
      workflow: {
        id: frontmatter.id || id,
        name: frontmatter.name || id,
        description: frontmatter.description,
      },
      phases: frontmatter.phases || frontmatter.steps || [],
      flow: frontmatter.flow,
    });
  }
}
