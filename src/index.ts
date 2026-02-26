#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { monitorCommand } from './commands/monitor.js';
import { runCommand } from './commands/run.js';
import { execCommand } from './commands/exec.js';
import { installCommand } from './commands/install.js';
import { doctorCommand } from './commands/doctor.js';
import { reportCommand } from './commands/report.js';
import { snapshotCommand } from './commands/snapshot.js';
import { rollbackCommand } from './commands/rollback.js';
import { pauseCommand } from './commands/pause.js';
import { configGetCommand, configSetCommand } from './commands/config-cmd.js';
import { moduleListCommand, moduleRemoveCommand } from './commands/module-cmd.js';
import { decisionsCommand } from './commands/decisions.js';
import { createModuleCommand, createAgentCommand, createTaskCommand, createWorkflowCommand } from './commands/create.js';

const program = new Command();

program
  .name('agentos')
  .description('Modular, runner-agnostic operating system for AI agents')
  .version('1.0.0');

// ─── Init & Setup ───
program
  .command('init')
  .description('Initialize AgentOS in the current project')
  .action(initCommand);

program
  .command('sync')
  .description('Regenerate runner integration files (CLAUDE.md, slash commands, etc.)')
  .action(syncCommand);

// ─── Module Management ───
program
  .command('install <source>')
  .description('Install a module (name, github:user/repo, or ./local-path)')
  .action(installCommand);

const moduleCmd = program
  .command('module')
  .description('Manage installed modules');

moduleCmd
  .command('list')
  .description('List installed modules')
  .action(moduleListCommand);

moduleCmd
  .command('remove <name>')
  .description('Remove an installed module')
  .action(moduleRemoveCommand);

// ─── Configuration ───
const configCmd = program
  .command('config')
  .description('View or update project configuration');

configCmd
  .command('get [key]')
  .description('Show configuration (or a specific key)')
  .action(configGetCommand);

configCmd
  .command('set <key> <value>')
  .description('Update a configuration value (e.g., project.runner "Claude Code")')
  .action(configSetCommand);

// ─── Workflow Operations ───
program
  .command('run <workflow>')
  .description('Start a workflow (e.g., story-development-cycle)')
  .option('--resume <sessionId>', 'Resume a paused session')
  .action((workflow, options) => runCommand(workflow, options));

program
  .command('exec <agent> <task>')
  .description('Execute a single task with a specific agent')
  .action(execCommand);

// ─── Diagnostics ───
program
  .command('doctor')
  .description('Run diagnostics and health check')
  .action(doctorCommand);

// ─── State Management ───
program
  .command('snapshot <action>')
  .description('Manage state snapshots (save, list)')
  .option('-l, --label <label>', 'Label for the snapshot')
  .action(snapshotCommand);

program
  .command('rollback [snapshot]')
  .description('Rollback to a specific snapshot')
  .action(rollbackCommand);

// ─── Telemetry ───
program
  .command('report')
  .description('Report telemetry from an AI agent session')
  .option('--sessionId <id>', 'Session ID')
  .option('--step <step>', 'Current step name')
  .option('--status <status>', 'Session status')
  .option('--tokens <count>', 'Tokens consumed')
  .option('--cost <usd>', 'Estimated cost in USD')
  .option('--agent <name>', 'Agent name for attribution')
  .action(reportCommand);

program
  .command('pause')
  .description('Pause the active session and generate a handoff file')
  .option('--sessionId <id>', 'Session ID to pause')
  .action(pauseCommand);

// ─── Monitor ───
program
  .command('monitor')
  .description('Launch the real-time session monitor (web UI)')
  .option('-p, --port <port>', 'Port to run on', '3000')
  .action(monitorCommand);

// ─── Scaffolding ───
const createCmd = program
  .command('create')
  .description('Scaffold new components (modules, agents, tasks, workflows)');

createCmd
  .command('module <name>')
  .description('Create a new module scaffold')
  .action(createModuleCommand);

createCmd
  .command('agent <name>')
  .description('Create a new agent definition')
  .action(createAgentCommand);

createCmd
  .command('task <name>')
  .description('Create a new task definition')
  .action(createTaskCommand);

createCmd
  .command('workflow <name>')
  .description('Create a new workflow definition')
  .action(createWorkflowCommand);

// ─── Decision Log ───
program
  .command('decisions')
  .description('View the decision log (architectural and technical decisions)')
  .option('--session <id>', 'Filter by session ID')
  .option('--agent <name>', 'Filter by agent name')
  .action(decisionsCommand);

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
