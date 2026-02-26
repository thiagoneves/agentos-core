# AgentOS

Modular, runner-agnostic operating system for AI agents. Provides workflow orchestration, context management, session tracking, and module packaging — works with Claude Code, Gemini CLI, Codex, or any LLM runner.

## Quick Start

```bash
# Install globally
npm install -g agent-os

# Initialize in your project
cd your-project
aos init

# Install the SDLC module
aos install sdlc

# Run a workflow
aos run story-development-cycle

# Check project health
aos doctor
```

## Commands

| Command | Description |
|---|---|
| `aos init` | Initialize AgentOS in the current project |
| `aos sync` | Regenerate runner integration files (CLAUDE.md, etc.) |
| `aos install <source>` | Install a module (`sdlc`, `github:user/repo`, `./path`) |
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
├── manifest.lock        # Module integrity lock
├── modules/             # Installed modules
│   └── sdlc/
│       ├── module.yaml  # Module manifest
│       ├── agents/      # Agent prompt templates
│       ├── tasks/       # Task definitions
│       └── workflows/   # Workflow definitions (YAML)
├── state/
│   └── sessions/        # Session state files (JSON)
├── memory/
│   └── index.yaml       # Artifact index
├── artifacts/           # Generated artifacts (.md)
└── snapshots/           # State snapshots for rollback
```

## Modules

Modules are self-contained packages of agents, tasks, workflows, and rules. Install from:

- **Built-in**: `aos install sdlc`
- **GitHub**: `aos install github:user/repo`
- **Local path**: `aos install ./my-module`

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

Features: sequential/parallel execution, decision routing, retry with backoff, user gates, and session pause/resume.

## Configuration

`config.yaml` controls project behavior:

```yaml
version: "1.0"
project:
  name: my-app
  state: brownfield
  runner: Auto-detect
  profile: solo
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

Start the real-time web dashboard:

```bash
aos board -p 3000
```

Shows active sessions, agent metrics, token usage, and cost tracking. Supports pause/resume via the UI.

## License

ISC
