import fs from 'fs/promises';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import YAML from 'yaml';
import { atomicWrite } from '../core/atomic-fs.js';
import { errorMessage } from '../core/errors.js';

// ─── Create Module ───

export const createModuleCommand = async (name: string) => {
  const baseDir = process.cwd();
  const modulesDir = path.join(baseDir, '.agentos', 'modules');
  const moduleDir = path.join(modulesDir, name);

  try {
    await fs.access(path.join(baseDir, '.agentos'));
  } catch {
    console.error(chalk.red('Not an AgentOS project. Run: aos init'));
    return;
  }

  try {
    await fs.access(moduleDir);
    console.error(chalk.red(`Module '${name}' already exists.`));
    return;
  } catch { /* good — doesn't exist */ }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      default: `${name} module`,
    },
    {
      type: 'input',
      name: 'author',
      message: 'Author:',
      default: '',
    },
    {
      type: 'input',
      name: 'domain',
      message: 'Domain (e.g., development, content, devops):',
      default: 'custom',
    },
  ]);

  try {
    // Create directory structure
    for (const dir of ['agents', 'tasks', 'workflows', 'rules']) {
      await fs.mkdir(path.join(moduleDir, dir), { recursive: true });
      await fs.writeFile(path.join(moduleDir, dir, '.gitkeep'), '', 'utf8');
    }

    // Create module.yaml
    const manifest = {
      name,
      version: '0.1.0',
      description: answers.description,
      author: answers.author || undefined,
      domain: answers.domain,
      agents: [],
      tasks: [],
      workflows: [],
      rules: [],
    };

    await atomicWrite(
      path.join(moduleDir, 'module.yaml'),
      YAML.stringify(manifest),
    );

    // Update config.yaml
    const { ConfigManager } = await import('../core/config.js');
    const configManager = new ConfigManager(baseDir);
    const config = await configManager.load();
    config.modules.installed.push({ name, version: '0.1.0', source: 'local' });
    await configManager.update({ modules: config.modules });

    console.log('');
    console.log(`  ${chalk.green('\u2713')} Module ${chalk.bold(name)} created`);
    console.log(chalk.dim(`    .agentos/modules/${name}/`));
    console.log(chalk.dim('    \u251C\u2500\u2500 module.yaml'));
    console.log(chalk.dim('    \u251C\u2500\u2500 agents/'));
    console.log(chalk.dim('    \u251C\u2500\u2500 tasks/'));
    console.log(chalk.dim('    \u251C\u2500\u2500 workflows/'));
    console.log(chalk.dim('    \u2514\u2500\u2500 rules/'));
    console.log('');
  } catch (err) {
    console.error(chalk.red(`Error: ${errorMessage(err)}`));
  }
};

// ─── Create Agent ───

export const createAgentCommand = async (name: string) => {
  const baseDir = process.cwd();
  const agentosDir = path.join(baseDir, '.agentos');

  try {
    await fs.access(agentosDir);
  } catch {
    console.error(chalk.red('Not an AgentOS project. Run: aos init'));
    return;
  }

  // List available targets (core + installed modules)
  const targets = await listTargets(agentosDir);

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'title',
      message: 'Agent title:',
      default: name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    },
    {
      type: 'input',
      name: 'domain',
      message: 'Domain (optional):',
      default: '',
    },
    {
      type: 'select',
      name: 'target',
      message: 'Add to:',
      choices: targets,
    },
  ]);

  try {
    const agentDir = answers.target === 'core'
      ? path.join(agentosDir, 'core', 'agents')
      : path.join(agentosDir, 'modules', answers.target, 'agents');

    await fs.mkdir(agentDir, { recursive: true });

    const content = agentTemplate(name, answers.title, answers.domain);
    const filePath = path.join(agentDir, `${name}.md`);

    try {
      await fs.access(filePath);
      console.error(chalk.red(`Agent '${name}' already exists in ${answers.target}.`));
      return;
    } catch { /* good */ }

    await atomicWrite(filePath, content);

    // Update module manifest if not core
    if (answers.target !== 'core') {
      await addToManifest(agentosDir, answers.target, 'agents', `agents/${name}.md`);
    }

    console.log(`  ${chalk.green('\u2713')} Agent ${chalk.bold(`@${name}`)} created in ${answers.target}`);
    console.log(chalk.dim(`    ${path.relative(baseDir, filePath)}`));
  } catch (err) {
    console.error(chalk.red(`Error: ${errorMessage(err)}`));
  }
};

// ─── Create Task ───

export const createTaskCommand = async (name: string) => {
  const baseDir = process.cwd();
  const agentosDir = path.join(baseDir, '.agentos');

  try {
    await fs.access(agentosDir);
  } catch {
    console.error(chalk.red('Not an AgentOS project. Run: aos init'));
    return;
  }

  const targets = await listTargets(agentosDir);
  const agents = await listAgents(agentosDir);

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'displayName',
      message: 'Task display name:',
      default: name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    },
    {
      type: 'select',
      name: 'agent',
      message: 'Executing agent:',
      choices: agents.length > 0 ? agents : [{ name: '(none)', value: '' }],
    },
    {
      type: 'select',
      name: 'target',
      message: 'Add to:',
      choices: targets,
    },
  ]);

  try {
    const taskDir = answers.target === 'core'
      ? path.join(agentosDir, 'core', 'tasks')
      : path.join(agentosDir, 'modules', answers.target, 'tasks');

    await fs.mkdir(taskDir, { recursive: true });

    const content = taskTemplate(name, answers.displayName, answers.agent);
    const filePath = path.join(taskDir, `${name}.md`);

    try {
      await fs.access(filePath);
      console.error(chalk.red(`Task '${name}' already exists in ${answers.target}.`));
      return;
    } catch { /* good */ }

    await atomicWrite(filePath, content);

    if (answers.target !== 'core') {
      await addToManifest(agentosDir, answers.target, 'tasks', `tasks/${name}.md`);
    }

    console.log(`  ${chalk.green('\u2713')} Task ${chalk.bold(name)} created in ${answers.target}`);
    console.log(chalk.dim(`    ${path.relative(baseDir, filePath)}`));
  } catch (err) {
    console.error(chalk.red(`Error: ${errorMessage(err)}`));
  }
};

// ─── Create Workflow ───

export const createWorkflowCommand = async (name: string) => {
  const baseDir = process.cwd();
  const agentosDir = path.join(baseDir, '.agentos');

  try {
    await fs.access(agentosDir);
  } catch {
    console.error(chalk.red('Not an AgentOS project. Run: aos init'));
    return;
  }

  const targets = await listTargets(agentosDir);

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'displayName',
      message: 'Workflow display name:',
      default: name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      default: '',
    },
    {
      type: 'select',
      name: 'target',
      message: 'Add to:',
      choices: targets,
    },
  ]);

  try {
    const workflowDir = answers.target === 'core'
      ? path.join(agentosDir, 'core', 'workflows')
      : path.join(agentosDir, 'modules', answers.target, 'workflows');

    await fs.mkdir(workflowDir, { recursive: true });

    const content = workflowTemplate(name, answers.displayName, answers.description);
    const filePath = path.join(workflowDir, `${name}.yaml`);

    try {
      await fs.access(filePath);
      console.error(chalk.red(`Workflow '${name}' already exists in ${answers.target}.`));
      return;
    } catch { /* good */ }

    await atomicWrite(filePath, content);

    if (answers.target !== 'core') {
      await addToManifest(agentosDir, answers.target, 'workflows', `workflows/${name}.yaml`);
    }

    console.log(`  ${chalk.green('\u2713')} Workflow ${chalk.bold(name)} created in ${answers.target}`);
    console.log(chalk.dim(`    ${path.relative(baseDir, filePath)}`));
  } catch (err) {
    console.error(chalk.red(`Error: ${errorMessage(err)}`));
  }
};

// ─── Helpers ───

async function listTargets(agentosDir: string): Promise<string[]> {
  const targets = ['core'];
  try {
    const dirs = await fs.readdir(path.join(agentosDir, 'modules'));
    for (const dir of dirs) {
      const stat = await fs.stat(path.join(agentosDir, 'modules', dir));
      if (stat.isDirectory()) targets.push(dir);
    }
  } catch { /* no modules dir */ }
  return targets;
}

async function listAgents(agentosDir: string): Promise<string[]> {
  const agents: string[] = [];

  // Core agents
  try {
    const files = await fs.readdir(path.join(agentosDir, 'core', 'agents'));
    for (const f of files) {
      if (f.endsWith('.md')) agents.push(f.replace('.md', ''));
    }
  } catch { /* no core agents */ }

  // Module agents
  try {
    const modules = await fs.readdir(path.join(agentosDir, 'modules'));
    for (const mod of modules) {
      try {
        const files = await fs.readdir(path.join(agentosDir, 'modules', mod, 'agents'));
        for (const f of files) {
          if (f.endsWith('.md')) agents.push(f.replace('.md', ''));
        }
      } catch { /* skip */ }
    }
  } catch { /* no modules */ }

  return agents;
}

async function addToManifest(
  agentosDir: string,
  moduleName: string,
  field: 'agents' | 'tasks' | 'workflows',
  relativePath: string,
): Promise<void> {
  const moduleDir = path.join(agentosDir, 'modules', moduleName);

  for (const filename of ['module.yaml', 'pack.yaml']) {
    const manifestPath = path.join(moduleDir, filename);
    try {
      const content = await fs.readFile(manifestPath, 'utf8');
      const raw = YAML.parse(content);
      const data = raw.pack || raw;

      if (!Array.isArray(data[field])) data[field] = [];
      if (!data[field].includes(relativePath)) {
        data[field].push(relativePath);
      }

      const output = raw.pack ? { pack: data } : data;
      await atomicWrite(manifestPath, YAML.stringify(output));
      return;
    } catch { /* try next */ }
  }
}

// ─── Templates ───

function agentTemplate(id: string, title: string, domain: string): string {
  return `---
id: ${id}
title: ${title}${domain ? `\ndomain: ${domain}` : ''}
---

# @${id} — ${title}

## Role

[Describe this agent's expertise and focus area]

## Core Principles

1. [First principle]
2. [Second principle]
3. [Third principle]

## Commands

| Command | Description |
|---------|-------------|
| *help | Show available commands |

## Authority

**Allowed:** [Operations this agent can perform]
**Blocked:** [Operations delegated to other agents]
`;
}

function taskTemplate(id: string, displayName: string, agent: string): string {
  return `---
task: ${id}
agent: ${agent || '[agent-id]'}
inputs: []
outputs: []
---

# ${displayName}

## Purpose

[What this task accomplishes]

## Prerequisites

- [What must be true before starting]

## Steps

### 1. First Step

[Instructions]

### 2. Second Step

[Instructions]

## Error Handling

- **[Error condition]:** [What to do]
`;
}

function workflowTemplate(id: string, displayName: string, description: string): string {
  return `workflow:
  id: ${id}
  name: ${displayName}
  description: >
    ${description || '[What this workflow accomplishes]'}

phases:
  - id: phase-1
    name: First Phase
    agent: "agent-id"
    task: "task-file.md"
    next: phase-2

  - id: phase-2
    name: Second Phase
    agent: "agent-id"
    task: "task-file.md"
`;
}
