# AgentOS

Modular, runner-agnostic operating system for AI coding agents. Orchestrates workflows, manages context windows, tracks sessions, and packages reusable modules — works with Claude Code, Gemini CLI, Codex CLI, Cursor, or any LLM runner.

## Install

```bash
git clone git@github.com:thiagoneves/agentos-core.git
cd agentos-core
npm install && npm run build
npm link
```

Or with the installer script:

```bash
./install.sh
```

## Quick Start

```bash
cd your-project

aos init                          # initialize .agentos/
aos install sdlc                  # install SDLC module from registry
aos sync                          # generate CLAUDE.md, GEMINI.md, etc.
aos run story-development-cycle   # start a workflow
aos doctor                        # check project health
```

## Commands

| Command | Description |
|---|---|
| `aos init` | Initialize AgentOS in the current project |
| `aos sync` | Regenerate runner integration files (CLAUDE.md, GEMINI.md, etc.) |
| `aos install <source>` | Install a module (registry, `github:user/repo`, or `./path`) |
| `aos module list` | List installed modules |
| `aos module remove <name>` | Remove an installed module |
| `aos run <workflow>` | Start a workflow |
| `aos run <workflow> --resume <id>` | Resume a paused session |
| `aos exec <agent> <task>` | Execute a single task with a specific agent |
| `aos config get [key]` | Show configuration (or a specific key) |
| `aos config set <key> <value>` | Update a configuration value |
| `aos snapshot save [-l label]` | Create a state snapshot |
| `aos snapshot list` | List available snapshots |
| `aos rollback [snapshot]` | Rollback to a snapshot |
| `aos pause` | Pause the active session and generate a handoff file |
| `aos report` | Report telemetry from an AI agent session |
| `aos board [-p port]` | Start the local web dashboard |
| `aos doctor` | Run diagnostics and health check |

## Architecture

```
.agentos/
├── config.yaml          # Project configuration
├── manifest.lock        # Module integrity lock (sha256)
├── registry-cache.yaml  # Cached module registry
├── core/
│   └── rules/           # Protocol and deviation rules
├── modules/             # Installed modules
│   └── sdlc/
│       ├── module.yaml  # Module manifest
│       ├── agents/      # Agent prompt templates
│       ├── tasks/       # Task definitions
│       ├── workflows/   # Workflow definitions (YAML)
│       ├── rules/       # Module-specific rules
│       └── squads/      # Multi-agent squad definitions
├── state/
│   ├── sessions/        # Session state files (JSON)
│   └── dashboard.json   # Aggregated session metrics
├── memory/
│   ├── gotchas.yaml     # Recurring error patterns
│   └── index.yaml       # Artifact index
├── artifacts/           # Generated artifacts (.md)
├── compiled/            # Compiled prompts (generated)
└── snapshots/           # State snapshots for rollback
```

## Modules

Modules are self-contained packages of agents, tasks, workflows, and rules. Install from three sources:

- **Registry**: `aos install sdlc` — downloads from the [remote registry](https://github.com/thiagoneves/agentos-modules)
- **GitHub**: `aos install github:user/repo` — clones a GitHub repository
- **Local path**: `aos install ./my-module` — copies from a local directory

Each module has a `module.yaml` manifest:

```yaml
name: sdlc
version: "1.0.0"
description: Complete Software Development Lifecycle
agents:
  - architect.md
  - developer.md
  - reviewer.md
workflows:
  - story-development-cycle.yaml
depends_on: []
```

## Workflows

Workflows define a sequence of phases, each executed by a specific agent:

```yaml
workflow:
  id: story-development-cycle
  name: Story Development Cycle

phases:
  - id: plan
    name: Architecture Planning
    agent: architect
    task: create-plan
    gate: user_approval
    next: implement

  - id: implement
    name: Implementation
    agent: developer
    task: implement-feature
    retry: 2
    timeoutMs: 300000
    next: review

  - id: review
    name: Code Review
    agent: reviewer
    task: review-code
    decision:
      approved: done
      changes_needed: implement
```

Features: sequential and parallel execution (`dependsOn`), decision routing, retry with backoff, user gates, session pause/resume with handoff files.

## Context Tracking

AgentOS monitors context window consumption across prompts using a bracket system:

| Bracket | Context remaining | Behavior |
|---|---|---|
| **FRESH** | 60-100% | Minimal injection (saves tokens) |
| **MODERATE** | 40-60% | Full context: session history, artifact index |
| **DEPLETED** | 25-40% | Adds gotcha hints (recurring error patterns) |
| **CRITICAL** | 0-25% | Handoff warning — wrap up and generate summary |

Token estimation uses content-aware analysis (symbols, whitespace, subword splits) instead of flat `chars/4`, achieving ~5-8% error vs real tokenizers.

## Runner Support

| Runner | Integration file | Context window |
|---|---|---|
| Claude Code | `CLAUDE.md` + `.claude/commands/` + `.claude/settings.json` | 200k |
| Gemini CLI | `GEMINI.md` + `.gemini/settings.json` | 1M |
| Codex CLI | `AGENTS.md` | 200k |
| Cursor | `.cursorrules` | 200k |

`aos sync` generates the appropriate files for the configured runner. Includes slash commands (`/aos:*`), tool permissions, and a PostToolUse hook for context monitoring.

## Configuration

`config.yaml` controls project behavior:

```yaml
version: "1.0"
project:
  name: my-app
  state: brownfield
  runner: Auto-detect
  output_language: English
engineering:
  stack: [typescript, react]
  testing_policy: post
  autonomy: balanced
  commit_pattern: conventional
settings:
  tokens:
    context_budget: "50%"
  git:
    auto_commit: true
  session:
    crash_detection_minutes: 30
    max_events: 200
```

## Dashboard

```bash
aos board -p 3000
```

Real-time web dashboard with WebSocket updates. Shows active sessions, agent metrics, token usage, and cost tracking. Supports pause/resume via the UI.

## Development

```bash
npm run build          # compile TypeScript
npm test               # run all tests (201 tests)
npm run test:watch     # watch mode
npm run lint           # eslint
npm run format         # prettier
```

## License

ISC
