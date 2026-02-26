import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { AgentOSConfig, ModuleManifest } from '../types/index.js';

export class RunnerManager {
  private baseDir: string;
  private agentosDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.agentosDir = path.join(baseDir, '.agentos');
  }

  async sync(config: AgentOSConfig): Promise<void> {
    const modules = await this.loadInstalledModules(config);

    await this.createProtocol(config, modules);

    switch (config.project.runner) {
      case 'Claude Code':
        await this.syncClaude(config, modules);
        break;
      case 'Gemini CLI':
        await this.syncGemini(config, modules);
        break;
      case 'Cursor':
        await this.syncCursor(config, modules);
        break;
      default:
        await this.syncClaude(config, modules);
        await this.syncGeneric(config, modules);
    }
  }

  private async createProtocol(config: AgentOSConfig, modules: ModuleManifest[]): Promise<void> {
    const lang = config.project.output_language;
    const agentList = modules.flatMap(m =>
      (m.agents || []).map(a => `- @${path.basename(a, '.md')} (${m.name})`)
    ).join('\n');

    const workflowList = modules.flatMap(m =>
      (m.workflows || []).map(w => `- ${path.basename(w, path.extname(w))} (${m.name})`)
    ).join('\n');

    const content = `# AgentOS Protocol

You are part of an automated Digital Squad managed by AgentOS.
Your behavior is governed by the files in \`.agentos/\`.

## Output Language
All human-facing output, documentation, comments, and artifacts MUST be written in **${lang}**.

## Architecture
\`\`\`
.agentos/
  config.yaml          — Project configuration
  core/agents/         — Core OS agents (maintainer, builder, doctor)
  modules/             — Domain modules with agents, tasks, workflows
  state/               — Runtime state and session tracking
  artifacts/           — Spec-driven documentation
  compiled/            — Compiled prompts (generated)
\`\`\`

## Available Agents
${agentList || '(none installed)'}

## Available Workflows
${workflowList || '(none installed)'}

## How to Execute
1. Read the agent definition from \`.agentos/modules/{module}/agents/{agent}.md\`
2. Read the task from \`.agentos/modules/{module}/tasks/{task}.md\`
3. Read any rules from \`.agentos/modules/{module}/rules/*.md\`
4. Follow every step in the task instructions
5. Save outputs to \`.agentos/artifacts/\` or the project source tree

## Telemetry
Report progress after each phase: \`agentos report --step "Phase" --status "running"\`

## State
Current progress is in \`.agentos/state/sessions/\`. Read before starting to avoid duplicating work.

## Project Isolation
This project is self-contained. Do NOT use knowledge, context, or memory from other projects.
Only reference files within this project directory and \`.agentos/\`.
Ignore any external project context, even if available in your memory.
`;

    const rulesDir = path.join(this.agentosDir, 'core', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.writeFile(path.join(rulesDir, 'protocol.md'), content, 'utf8');

    await this.createDeviationRules(rulesDir);
  }

  private async createDeviationRules(rulesDir: string): Promise<void> {
    const content = `# Deviation Rules

When executing tasks, follow these rules to decide what you can do autonomously vs. when you must stop and ask for user approval.

## AUTO-FIX (proceed silently)
Fix these inline without asking:
- Bug fixes and logic errors
- Type errors and compilation failures
- Lint violations and formatting issues
- Broken imports and missing dependencies

## AUTO-ADD (proceed, note in report)
Add these automatically and mention in the progress report:
- Missing error handling or try/catch blocks
- Input validation and null checks
- Missing auth checks or rate limiting
- Test coverage for new code

## AUTO-RESOLVE (proceed, note in report)
Resolve these to unblock progress:
- Missing environment variables (use sensible defaults)
- Blocking package dependencies (install compatible version)
- Broken imports from refactored code
- Minor config mismatches

## STOP (ask user before proceeding)
NEVER do these without explicit user approval:
- Adding new database tables or schema changes
- Changing system architecture or adding new services
- Switching libraries or frameworks
- Modifying CI/CD pipelines or deployment configs
- Deleting files or removing features
- Changes that affect other teams or external APIs
`;
    await fs.writeFile(path.join(rulesDir, 'deviation-rules.md'), content, 'utf8');
  }

  private async syncClaudeSettings(config: AgentOSConfig): Promise<void> {
    const settingsDir = path.join(this.baseDir, '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');

    const requiredPermissions = [
      'Bash(aos:*)',
      'Bash(agentos:*)',
    ];

    if (config.settings.git.auto_commit) {
      requiredPermissions.push('Bash(git add:*)', 'Bash(git commit:*)');
    }

    interface ClaudeSettings {
      permissions?: { allow?: string[] };
      hooks?: Record<string, unknown>;
      [key: string]: unknown;
    }

    let settings: ClaudeSettings = {};
    try {
      const content = await fs.readFile(settingsPath, 'utf8');
      settings = JSON.parse(content);
    } catch { /* file doesn't exist yet */ }

    if (!settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

    for (const perm of requiredPermissions) {
      if (!settings.permissions.allow.includes(perm)) {
        settings.permissions.allow.push(perm);
      }
    }

    // Add context monitor hook
    if (!settings.hooks) settings.hooks = {};
    const pkgRoot = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');
    const hookCommand = `node ${path.join(pkgRoot, 'src', 'hooks', 'context-monitor.cjs')}`;

    settings.hooks.PostToolUse = [
      {
        matcher: '',
        hooks: [{
          type: 'command',
          command: hookCommand,
          timeout: 5,
        }],
      },
    ];

    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  private async syncClaude(config: AgentOSConfig, modules: ModuleManifest[]): Promise<void> {
    const lang = config.project.output_language;
    const commands = this.buildCommandList(modules);

    const content = `# AgentOS — Claude Code Integration

Read and follow the protocol at \`.agentos/core/rules/protocol.md\`.

## Output Language: ${lang}

## Project: ${config.project.name}
- **Stack:** ${config.engineering.stack.join(', ') || 'Not specified'}

## Slash Commands
${commands.map(c => `- \`/aos:${c.id}\` — ${c.description}`).join('\n')}
- \`/aos:status\` — Show current workflow progress
- \`/aos:help\` — List all available commands

## Quick Start
1. Read \`.agentos/config.yaml\` for project configuration
2. Read agent definitions in \`.agentos/modules/*/agents/\`
3. Follow task instructions in \`.agentos/modules/*/tasks/\`
4. Save artifacts to \`.agentos/artifacts/\`
5. Report progress with \`agentos report\`

## Rules
Always read \`.agentos/modules/*/rules/*.md\` before executing any task.

## Project Isolation
This project is self-contained. Do NOT use knowledge, context, or memory from other projects.
Only reference files within this project directory and \`.agentos/\`.
Ignore any external project context, even if available in your memory.
`;

    await fs.writeFile(path.join(this.baseDir, 'CLAUDE.md'), content, 'utf8');

    const claudeCommandsDir = path.join(this.baseDir, '.claude', 'commands', 'aos');
    await fs.mkdir(claudeCommandsDir, { recursive: true });

    for (const cmd of commands) {
      const cmdContent = `---
name: aos:${cmd.id}
description: ${cmd.description}
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

<process>
## Step 1: Initialize session (MANDATORY — run this FIRST)
\`\`\`bash
aos run ${cmd.id}
\`\`\`
This creates a tracked session in \`.agentos/state/sessions/\` and compiles prompts.
Read the output to get the session ID.

## Step 2: Check for previous handoff
If \`.agentos/state/.handoff.md\` exists, read it first.
It contains context from a previous session (completed phases, current state, next action).
Use it to resume work without duplicating effort.

## Step 3: Execute each phase
Read \`.agentos/modules/${cmd.module}/workflows/${cmd.workflow}\` for the phase list.
For each phase:
1. Read the agent definition: \`.agentos/modules/${cmd.module}/agents/{agent}.md\`
2. Read the task: \`.agentos/modules/${cmd.module}/tasks/{task}.md\`
3. Read rules: \`.agentos/modules/${cmd.module}/rules/*.md\`
4. Execute the task following all instructions
5. Report progress after each phase:
   \`\`\`bash
   aos report --step "<phase-name>" --status running --agent "<agent-name>"
   \`\`\`

## Step 4: Complete
\`\`\`bash
aos report --step "Done" --status completed --agent "<agent-name>"
\`\`\`
</process>
`;
      await fs.writeFile(path.join(claudeCommandsDir, `${cmd.id}.md`), cmdContent, 'utf8');
    }

    // Always generate status and help commands
    await fs.writeFile(path.join(claudeCommandsDir, 'status.md'), `---
name: aos:status
description: Show current AgentOS workflow progress
allowed-tools:
  - Read
  - Glob
---

<process>
Read \`.agentos/state/sessions/\` and \`.agentos/state/dashboard.json\` to show current progress.
Summarize: active workflow, current phase, agent, and any pending gates.
</process>
`, 'utf8');

    await fs.writeFile(path.join(claudeCommandsDir, 'help.md'), `---
name: aos:help
description: List all AgentOS commands and workflows
allowed-tools:
  - Read
  - Glob
---

<process>
Read \`.agentos/config.yaml\` and list all installed modules.
For each module, list available workflows from \`.agentos/modules/{module}/workflows/\`.
Show the command mapping: /aos:{workflow-id}
</process>
`, 'utf8');

    await this.syncClaudeSettings(config);
  }

  private async syncGeminiSettings(config: AgentOSConfig): Promise<void> {
    const settingsDir = path.join(this.baseDir, '.gemini');
    const settingsPath = path.join(settingsDir, 'settings.json');

    interface GeminiSettings {
      tools?: { allowed?: string[] };
      context?: { fileName?: string[] };
      hooks?: Record<string, unknown>;
      [key: string]: unknown;
    }

    let settings: GeminiSettings = {};
    try {
      const content = await fs.readFile(settingsPath, 'utf8');
      settings = JSON.parse(content);
    } catch { /* file doesn't exist yet */ }

    // Tool permissions — auto-approve AgentOS CLI commands
    if (!settings.tools) settings.tools = {};
    if (!Array.isArray(settings.tools.allowed)) settings.tools.allowed = [];

    const requiredPermissions = [
      'run_shell_command(aos)',
      'run_shell_command(agentos)',
    ];

    if (config.settings.git.auto_commit) {
      requiredPermissions.push('run_shell_command(git add)', 'run_shell_command(git commit)');
    }

    for (const perm of requiredPermissions) {
      if (!settings.tools.allowed.includes(perm)) {
        settings.tools.allowed.push(perm);
      }
    }

    // Context — ensure GEMINI.md is loaded as instruction file
    if (!settings.context) settings.context = {};
    if (!Array.isArray(settings.context.fileName)) settings.context.fileName = ['GEMINI.md'];
    if (!settings.context.fileName.includes('GEMINI.md')) {
      settings.context.fileName.push('GEMINI.md');
    }

    // Context monitor hook (AfterTool = Gemini equivalent of Claude's PostToolUse)
    if (!settings.hooks) settings.hooks = {};
    const pkgRoot = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');
    const hookCommand = `node ${path.join(pkgRoot, 'src', 'hooks', 'context-monitor.cjs')}`;

    settings.hooks.AfterTool = [
      {
        matcher: '',
        hooks: [{
          type: 'command',
          command: hookCommand,
          timeout: 5000,
        }],
      },
    ];

    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  private async syncGemini(config: AgentOSConfig, modules: ModuleManifest[]): Promise<void> {
    const lang = config.project.output_language;
    const commands = this.buildCommandList(modules);

    const content = `# AgentOS — Gemini CLI Integration

Read and follow the protocol at \`.agentos/core/rules/protocol.md\`.

## Output Language: ${lang}

## Project: ${config.project.name}
- **Stack:** ${config.engineering.stack.join(', ') || 'Not specified'}

## Available Workflows
${commands.length > 0 ? commands.map(c => `- \`aos run ${c.id}\` — ${c.description}`).join('\n') : '(none installed)'}
- \`aos report\` — Show current workflow progress

## How to Execute
1. Read \`.agentos/config.yaml\` for project configuration
2. Read agent definitions from \`.agentos/modules/*/agents/*.md\`
3. Read rules from \`.agentos/modules/*/rules/*.md\` before executing any task
4. Execute tasks from \`.agentos/modules/*/tasks/*.md\`
5. Save artifacts to \`.agentos/artifacts/\`
6. Report progress: \`aos report --step "Phase" --status "running"\`

## Quick Reference
\`\`\`bash
aos run <workflow>     # Start a workflow
aos report             # Check progress
aos doctor             # Diagnose project health
aos monitor            # Open web dashboard
\`\`\`

## Project Isolation
This project is self-contained. Do NOT use knowledge, context, or memory from other projects.
Only reference files within this project directory and \`.agentos/\`.
Ignore any external project context, even if available in your memory.
`;

    await fs.writeFile(path.join(this.baseDir, 'GEMINI.md'), content, 'utf8');
    await this.syncGeminiSettings(config);
  }

  private async syncCursor(config: AgentOSConfig, _modules: ModuleManifest[]): Promise<void> {
    const lang = config.project.output_language;
    const content = `# AgentOS Protocol

Read .agentos/core/rules/protocol.md for the full operating protocol.
Output language: ${lang}. Project: ${config.project.name}.

Always read agent definitions before executing tasks.
Follow rules in .agentos/modules/*/rules/*.md.
Report progress: agentos report --step "Phase" --status "running"
`;

    await fs.writeFile(path.join(this.baseDir, '.cursorrules'), content, 'utf8');
  }

  private async syncGeneric(config: AgentOSConfig, modules: ModuleManifest[]): Promise<void> {
    const lang = config.project.output_language;
    const commands = this.buildCommandList(modules);

    const content = `# AgentOS — Agent Instructions

Read .agentos/core/rules/protocol.md for the full operating protocol.

## Output Language: ${lang}

## Available Commands
${commands.map(c => `- aos:${c.id} — ${c.description}`).join('\n')}

## How to Use
1. Read the protocol at .agentos/core/rules/protocol.md
2. Read agent and task files from .agentos/modules/*/
3. Follow workflow steps sequentially
`;

    await fs.writeFile(path.join(this.baseDir, 'AGENTS.md'), content, 'utf8');
  }

  private buildCommandList(modules: ModuleManifest[]): Array<{
    id: string; name: string; description: string; module: string; workflow: string;
  }> {
    return modules.flatMap(m =>
      (m.workflows || []).map(w => {
        const basename = path.basename(w, path.extname(w));
        return {
          id: basename,
          name: basename.replace(/-/g, ' '),
          description: `Run ${basename} workflow from ${m.name}`,
          module: m.name,
          workflow: path.basename(w),
        };
      })
    );
  }

  private async loadInstalledModules(config: AgentOSConfig): Promise<ModuleManifest[]> {
    const modules: ModuleManifest[] = [];
    for (const mod of config.modules.installed) {
      for (const filename of ['module.yaml', 'pack.yaml']) {
        const manifestPath = path.join(this.agentosDir, 'modules', mod.name, filename);
        try {
          const content = await fs.readFile(manifestPath, 'utf8');
          const raw = YAML.parse(content);
          modules.push(raw.pack || raw);
          break;
        } catch { /* try next */ }
      }
    }
    return modules;
  }
}
