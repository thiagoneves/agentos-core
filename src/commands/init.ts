import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { ConfigManager } from '../core/config.js';
import { RunnerManager } from '../core/runner-manager.js';
import { ModuleManager } from '../core/module-manager.js';
import { GlobalMemoryManager } from '../core/global-memory.js';
import { errorMessage } from '../core/errors.js';

export const initCommand = async () => {
  const baseDir = process.cwd();
  const configManager = new ConfigManager(baseDir);
  const runnerManager = new RunnerManager(baseDir);
  const moduleManager = new ModuleManager(baseDir);
  const globalMemory = new GlobalMemoryManager();

  const c = chalk.cyan;
  const w = chalk.white.bold;
  const d = chalk.dim;

  const banner = [
    '',
    `  ${c('█▀▀█ █▀▀▀ █▀▀ █▀▀▄ ▀▀█▀▀')}${w(' █▀▀█ █▀▀')}`,
    `  ${c('█▄▄█ █ ▀█ █▀▀ █  █   █  ')}${w(' █  █ ▀▀█')}`,
    `  ${c('▀  ▀ ▀▀▀▀ ▀▀▀ ▀  ▀   ▀  ')}${w(' ▀▀▀▀ ▀▀▀')}`,
    '',
    `  ${d('v1.0.0')} ${d('·')} ${d('Modular OS for AI Agents')}`,
    '',
  ];
  console.log(banner.join('\n'));

  // Check if already initialized
  if (await configManager.exists()) {
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: '.agentos/ already exists. Reinitialize?',
      default: false,
    }]);
    if (!overwrite) {
      console.log(chalk.dim('  Aborted.'));
      return;
    }
  }

  const memory = await globalMemory.load();
  const availableModules = await moduleManager.getAvailableModules();

  // ─── Interactive Prompts ───
  const answers = await inquirer.prompt([
    {
      type: 'select',
      name: 'output_language',
      message: 'Output language (for docs/artifacts):',
      choices: [
        { name: 'English', value: 'en' },
        { name: 'Portuguese (Brazil)', value: 'pt-BR' },
        { name: 'Spanish', value: 'es' },
      ],
      default: memory.preferences.default_language || 'en',
    },
    {
      type: 'select',
      name: 'runner',
      message: 'Select your AI runner:',
      choices: ['Auto-detect', 'Claude Code', 'Gemini CLI', 'Cursor'],
      default: memory.preferences.default_runner || 'Auto-detect',
    },
    {
      type: 'select',
      name: 'model_profile',
      message: 'Model profile (cost vs quality):',
      choices: [
        { name: 'Quality — best models for all tasks (higher cost)', value: 'quality' },
        { name: 'Balanced — smart mix of models per role (recommended)', value: 'balanced' },
        { name: 'Budget — lighter models, lower cost', value: 'budget' },
      ],
      default: 'balanced',
    },
    {
      type: 'select',
      name: 'state',
      message: 'Project state:',
      choices: [
        { name: 'Greenfield (new project)', value: 'greenfield' },
        { name: 'Brownfield (existing project)', value: 'brownfield' },
      ],
      default: 'brownfield',
    },
    {
      type: 'checkbox',
      name: 'selected_modules',
      message: 'Select modules to install:',
      choices: availableModules.map(m => ({
        name: `${m.name} - ${m.description}`,
        value: m.name,
        checked: m.name === 'sdlc',
      })),
    },
    {
      type: 'confirm',
      name: 'init_artifacts',
      message: 'Initialize spec artifacts?',
      default: true,
    },
    {
      type: 'select',
      name: 'git_mode',
      message: 'Git integration:',
      choices: [
        { name: 'Auto-commit artifacts', value: 'auto' },
        { name: 'Manual commits only', value: 'manual' },
        { name: 'No git integration', value: 'none' },
      ],
      default: 'auto',
    },
  ]);

  try {
    // 1. Create config
    await configManager.init({
      project: {
        name: path.basename(baseDir),
        output_language: answers.output_language,
        runner: answers.runner,
        model_profile: answers.model_profile,
        state: answers.state,
      },
      settings: {
        git: {
          auto_commit: answers.git_mode === 'auto',
          commit_prefix: 'aos',
        },
        tokens: {
          context_budget: '50%',
          summary_max_lines: 50,
          index_enabled: true,
        },
        session: {
          crash_detection_minutes: 30,
          max_events: 200,
        },
      },
    });
    const g = chalk.green;
    const tick = g('✓');

    console.log(`\n  ${w('Setting up')}\n`);

    console.log(`  ${tick} config.yaml`);

    await createCoreOS(baseDir);
    console.log(`  ${tick} core/`);

    await createStateStructure(baseDir);
    console.log(`  ${tick} state/`);

    if (answers.init_artifacts) {
      await createArtifacts(baseDir, answers.output_language);
      console.log(`  ${tick} artifacts/`);
    }

    for (const modName of answers.selected_modules) {
      await moduleManager.install(modName);
      await globalMemory.recordModuleUsage(modName);
      console.log(`  ${tick} module ${c(modName)}`);
    }

    const updatedConfig = await configManager.load();

    await runnerManager.sync(updatedConfig);
    console.log(`  ${tick} runner ${c(answers.runner)}`);

    await updateGitignore(baseDir);
    console.log(`  ${tick} .gitignore`);

    await globalMemory.updatePreferences({
      default_language: answers.output_language,
      default_runner: answers.runner,
    });

    // ─── Summary ───
    const projectName = path.basename(baseDir);
    const modulesInstalled = answers.selected_modules.length > 0
      ? answers.selected_modules.join(', ')
      : 'none';

    console.log('');
    console.log(`  ${g.bold('⚡ AgentOS initialized!')}`);
    console.log('');
    console.log(`  ${w('Project')}    ${projectName}`);
    console.log(`  ${w('Runner')}     ${answers.runner}`);
    console.log(`  ${w('Modules')}    ${modulesInstalled}`);
    console.log(`  ${w('Language')}   ${answers.output_language}`);
    console.log('');
    console.log(`  ${d('Run')} ${c('aos --help')} ${d('to see all available commands.')}`);
    console.log('');
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${errorMessage(err)}`));
    if (process.env.DEBUG && err instanceof Error) console.error(err.stack);
  }
};

async function createCoreOS(baseDir: string): Promise<void> {
  const coreDir = path.join(baseDir, '.agentos', 'core');

  // Core agents
  const agentsDir = path.join(coreDir, 'agents');
  await fs.mkdir(agentsDir, { recursive: true });

  await fs.writeFile(path.join(agentsDir, 'maintainer.md'), `---
id: maintainer
title: System Maintainer
module: core
---

# @maintainer -- System Maintainer

## Role
You manage the AgentOS configuration and module lifecycle.

## Responsibilities
- Validate \`.agentos/config.yaml\` integrity
- Install, update, and remove modules
- Resolve module dependencies
- Manage \`manifest.lock\`

## Commands
| Command | Action |
| :--- | :--- |
| \`agentos install <source>\` | Install a module from registry, GitHub, or local path |
| \`agentos remove <name>\` | Remove an installed module |
| \`agentos sync\` | Regenerate runner integration files |
`, 'utf8');

  await fs.writeFile(path.join(agentsDir, 'builder.md'), `---
id: builder
title: Component Builder
module: core
---

# @builder -- Component Builder

## Role
You scaffold new AgentOS components: modules, agents, tasks, workflows.

## Responsibilities
- Generate module scaffolds with correct directory structure
- Create agent definitions with proper frontmatter
- Create task files with input/output specs
- Create workflow definitions with phase structure

## Output
All generated files follow the AgentOS file schemas defined in the DESIGN.md.
`, 'utf8');

  await fs.writeFile(path.join(agentsDir, 'doctor.md'), `---
id: doctor
title: System Doctor
module: core
---

# @doctor -- System Doctor

## Role
You diagnose and repair AgentOS configuration and state issues.

## Checks
1. \`config.yaml\` exists and validates against schema
2. All installed modules have valid \`module.yaml\`
3. All referenced files in module manifests exist
4. \`manifest.lock\` matches installed modules
5. State files are valid JSON/YAML
6. No orphaned sessions in state/sessions/

## Repair Actions
- Regenerate \`manifest.lock\` from installed modules
- Remove orphaned session files
- Recreate missing directories
- Re-sync runner integration
`, 'utf8');

  // Core rules
  const rulesDir = path.join(coreDir, 'rules');
  await fs.mkdir(rulesDir, { recursive: true });
  // Protocol is generated by runner-manager.sync()
}

async function createStateStructure(baseDir: string): Promise<void> {
  const stateDir = path.join(baseDir, '.agentos', 'state');
  await fs.mkdir(path.join(stateDir, 'sessions'), { recursive: true });

  await fs.writeFile(path.join(stateDir, 'current.yaml'), `status: idle
workflow: null
phase: null
session: null
`, 'utf8');

  await fs.writeFile(path.join(stateDir, 'history.yaml'), `version: "1.0"
completed: []
`, 'utf8');

  // Memory directories
  const memoryDir = path.join(baseDir, '.agentos', 'memory');
  await fs.mkdir(path.join(memoryDir, 'summaries'), { recursive: true });

  await fs.writeFile(path.join(memoryDir, 'index.yaml'), `version: "1.0"
artifacts: {}
`, 'utf8');

  // Compiled (gitignored)
  await fs.mkdir(path.join(baseDir, '.agentos', 'compiled'), { recursive: true });

  // Logs (gitignored)
  await fs.mkdir(path.join(baseDir, '.agentos', 'logs'), { recursive: true });
}

async function createArtifacts(baseDir: string, _lang: string): Promise<void> {
  const artifactsDir = path.join(baseDir, '.agentos', 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  const projectName = path.basename(baseDir);

  await fs.writeFile(path.join(artifactsDir, '00-context.md'), `# Project Context

## Project: ${projectName}
- **Stack:** (to be defined)
- **Architecture:** (to be defined)
- **Conventions:** (to be defined)

## Key Decisions
(Record important technical decisions here)
`, 'utf8');

  await fs.writeFile(path.join(artifactsDir, '01-requirements.md'), `# Requirements

## User Stories
(Define user stories and acceptance criteria here)

## Non-Functional Requirements
(Performance, security, scalability requirements)
`, 'utf8');

  await fs.writeFile(path.join(artifactsDir, '02-architecture.md'), `# Architecture

## System Design
(High-level architecture diagram and description)

## Data Model
(Entity relationships and database schema)

## API Contracts
(Endpoint definitions and contracts)
`, 'utf8');

  await fs.writeFile(path.join(artifactsDir, '05-plan.md'), `# Implementation Plan

## Phases
(Break down the implementation into phases)

## Current Phase
(Active phase details and progress)
`, 'utf8');
}

async function updateGitignore(baseDir: string): Promise<void> {
  const gitignorePath = path.join(baseDir, '.gitignore');
  const agentosEntries = `
# AgentOS
.agentos/compiled/
.agentos/logs/
.agentos/.tmp/
.agentos/state/sessions/
.agentos/registry-cache.yaml
`;

  try {
    const existing = await fs.readFile(gitignorePath, 'utf8');
    if (!existing.includes('.agentos/compiled/')) {
      await fs.writeFile(gitignorePath, existing + agentosEntries, 'utf8');
    }
  } catch {
    await fs.writeFile(gitignorePath, agentosEntries.trim() + '\n', 'utf8');
  }
}
