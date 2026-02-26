import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { ConfigManager } from '../core/config.js';
import { RunnerManager } from '../core/runner-manager.js';
import { ModuleManager } from '../core/module-manager.js';
import { errorMessage } from '../core/errors.js';

type Status = 'ok' | 'fixed' | 'warn' | 'fail';

function log(status: Status, msg: string): void {
  const icons: Record<Status, string> = {
    ok:    chalk.green('  ✓'),
    fixed: chalk.cyan('  ✓'),
    warn:  chalk.yellow('  ~'),
    fail:  chalk.red('  ✗'),
  };
  const suffix = status === 'fixed' ? chalk.cyan(' (fixed)') : '';
  console.log(`${icons[status]} ${msg}${suffix}`);
}

export const doctorCommand = async () => {
  const baseDir = process.cwd();
  const agentosDir = path.join(baseDir, '.agentos');
  const configManager = new ConfigManager(baseDir);
  const runnerManager = new RunnerManager(baseDir);
  const moduleManager = new ModuleManager(baseDir);

  console.log(chalk.bold('\n  AgentOS Doctor\n'));

  let issues = 0;
  let warnings = 0;
  let fixed = 0;

  // ─── 1. Check .agentos directory ───
  try {
    await fs.access(agentosDir);
    log('ok', '.agentos/ directory');
  } catch {
    log('fail', '.agentos/ directory missing. Run: aos init');
    issues++;
    return;
  }

  // ─── 2. Validate config ───
  let config;
  try {
    config = await configManager.load();
    log('ok', `config.yaml (${config.project.name}, ${config.project.runner})`);
  } catch (err) {
    log('fail', `config.yaml invalid: ${errorMessage(err)}`);
    issues++;
    return; // Can't auto-heal without valid config
  }

  // ─── 3. Core agents ───
  const coreAgentsDir = path.join(agentosDir, 'core', 'agents');
  const coreAgents: Record<string, string> = {
    'maintainer.md': `---\nid: maintainer\ntitle: System Maintainer\nmodule: core\n---\n\n# @maintainer -- System Maintainer\n`,
    'builder.md': `---\nid: builder\ntitle: Component Builder\nmodule: core\n---\n\n# @builder -- Component Builder\n`,
    'doctor.md': `---\nid: doctor\ntitle: System Doctor\nmodule: core\n---\n\n# @doctor -- System Doctor\n`,
  };

  for (const [agent, skeleton] of Object.entries(coreAgents)) {
    try {
      await fs.access(path.join(coreAgentsDir, agent));
      log('ok', `core/agents/${agent}`);
    } catch {
      await fs.mkdir(coreAgentsDir, { recursive: true });
      await fs.writeFile(path.join(coreAgentsDir, agent), skeleton, 'utf8');
      log('fixed', `core/agents/${agent}`);
      fixed++;
    }
  }

  // ─── 4. Protocol & rules ───
  const protocolPath = path.join(agentosDir, 'core', 'rules', 'protocol.md');
  try {
    await fs.access(protocolPath);
    log('ok', 'core/rules/protocol.md');
  } catch {
    try {
      await runnerManager.sync(config);
      log('fixed', 'core/rules/protocol.md (re-synced)');
      fixed++;
    } catch (err) {
      log('warn', `core/rules/protocol.md — sync failed: ${errorMessage(err)}`);
      warnings++;
    }
  }

  // ─── 5. State directories ───
  const requiredDirs = ['state', 'state/sessions', 'memory', 'memory/summaries', 'artifacts', 'compiled', 'logs'];
  for (const dir of requiredDirs) {
    const dirPath = path.join(agentosDir, dir);
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
      log('fixed', `${dir}/`);
      fixed++;
    }
  }

  // ─── 6. State files ───
  const stateFiles: Record<string, string> = {
    'state/current.yaml': 'status: idle\nworkflow: null\nphase: null\nsession: null\n',
    'memory/index.yaml': 'version: "1.0"\nartifacts: {}\n',
  };

  for (const [file, content] of Object.entries(stateFiles)) {
    const filePath = path.join(agentosDir, file);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, content, 'utf8');
      log('fixed', file);
      fixed++;
    }
  }

  // ─── 7. Installed modules ───
  for (const mod of config.modules.installed) {
    const modDir = path.join(agentosDir, 'modules', mod.name);
    try {
      const manifest = await moduleManager.loadManifest(modDir);
      const counts = [
        `${manifest.agents?.length || 0} agents`,
        `${manifest.tasks?.length || 0} tasks`,
        `${manifest.workflows?.length || 0} workflows`,
      ].join(', ');
      log('ok', `module: ${manifest.name} v${manifest.version} (${counts})`);

      // Check referenced files
      const allFiles = [
        ...(manifest.agents || []),
        ...(manifest.tasks || []),
        ...(manifest.workflows || []),
        ...(manifest.rules || []),
      ];
      let missing = 0;
      for (const file of allFiles) {
        try { await fs.access(path.join(modDir, file)); } catch { missing++; }
      }
      if (missing > 0) {
        log('warn', `  ${missing} referenced file(s) missing in ${mod.name}`);
        warnings++;
      }
    } catch {
      log('fail', `module ${mod.name}: invalid or missing manifest`);
      issues++;
    }
  }

  // ─── 8. Manifest lock ───
  const lockPath = path.join(agentosDir, 'manifest.lock');
  try {
    await fs.access(lockPath);
    log('ok', 'manifest.lock');
  } catch {
    if (config.modules.installed.length > 0) {
      // Re-install modules to regenerate lock
      for (const mod of config.modules.installed) {
        try { await moduleManager.install(mod.name); } catch { /* best effort */ }
      }
      log('fixed', 'manifest.lock (regenerated)');
      fixed++;
    }
  }

  // ─── 9. Runner integration ───
  const runnerFiles = ['CLAUDE.md', 'GEMINI.md', '.cursorrules', 'AGENTS.md'];
  let hasRunner = false;
  for (const f of runnerFiles) {
    try {
      await fs.access(path.join(baseDir, f));
      hasRunner = true;
      log('ok', f);
      break;
    } catch { /* continue */ }
  }
  if (!hasRunner) {
    try {
      await runnerManager.sync(config);
      log('fixed', 'runner integration (re-synced)');
      fixed++;
    } catch (err) {
      log('warn', `runner integration — sync failed: ${errorMessage(err)}`);
      warnings++;
    }
  }

  // ─── Summary ───
  console.log('');
  if (issues === 0 && warnings === 0 && fixed === 0) {
    console.log(chalk.bold.green('  All checks passed.'));
  } else if (issues === 0 && fixed > 0) {
    console.log(chalk.bold.cyan(`  ${fixed} issue(s) auto-repaired.`) + (warnings > 0 ? chalk.yellow(` ${warnings} warning(s).`) : ''));
  } else if (issues === 0) {
    console.log(chalk.bold.yellow(`  ${warnings} warning(s). System is functional.`));
  } else {
    console.log(chalk.bold.red(`  ${issues} issue(s), ${warnings} warning(s). Some problems require manual intervention.`));
  }
  console.log('');
};
