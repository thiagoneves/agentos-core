import { spawn } from 'child_process';
import fs from 'fs/promises';
import type { RunnerResult, RunnerExecutor } from '../types/index.js';

export type { RunnerResult, RunnerExecutor } from '../types/index.js';

// ─── Helpers ────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 10 * 60 * 1000; // 10 minutes per phase

const commandExistsCache = new Map<string, boolean>();

async function commandExists(cmd: string): Promise<boolean> {
  const cached = commandExistsCache.get(cmd);
  if (cached !== undefined) return cached;

  return new Promise(resolve => {
    const child = spawn('which', [cmd], { stdio: 'ignore' });
    child.on('close', code => {
      const exists = code === 0;
      commandExistsCache.set(cmd, exists);
      resolve(exists);
    });
    child.on('error', () => {
      commandExistsCache.set(cmd, false);
      resolve(false);
    });
  });
}

function spawnCapture(
  cmd: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Runner timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.on('close', code => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1, durationMs: Date.now() - start });
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    // Pipe prompt content via stdin
    child.stdin.write(input);
    child.stdin.end();
  });
}

// ─── Claude Code ────────────────────────────────────────────────────

/**
 * Executes prompts via `claude -p --output-format json`.
 *
 * Claude Code CLI returns JSON:
 * { result, cost_usd, is_error, num_turns, duration_ms, session_id }
 */
export class ClaudeExecutor implements RunnerExecutor {
  readonly name = 'claude-code';

  async isAvailable(): Promise<boolean> {
    return commandExists('claude');
  }

  async run(promptPath: string, cwd: string, timeoutMs = DEFAULT_TIMEOUT, model?: string): Promise<RunnerResult> {
    const prompt = await fs.readFile(promptPath, 'utf8');

    const args = ['-p', '--output-format', 'json'];
    if (model) args.push('--model', model);

    const { stdout, stderr, exitCode, durationMs } = await spawnCapture(
      'claude',
      args,
      prompt,
      cwd,
      timeoutMs
    );

    // Try to parse structured JSON output
    try {
      const json = JSON.parse(stdout);
      return {
        output: json.result || stdout,
        exitCode: json.is_error ? 1 : 0,
        tokensUsed: estimateTokensFromCost(json.cost_usd || 0),
        costUsd: json.cost_usd || 0,
        error: json.is_error ? (json.result || stderr) : undefined,
        durationMs: json.duration_ms || durationMs,
      };
    } catch {
      // Fallback: non-JSON output (older CLI version or error)
      return {
        output: stdout,
        exitCode,
        tokensUsed: 0,
        costUsd: 0,
        error: exitCode !== 0 ? (stderr || stdout).slice(0, 500) : undefined,
        durationMs,
      };
    }
  }
}

// ─── Gemini CLI ─────────────────────────────────────────────────────

/**
 * Executes prompts via `gemini` CLI.
 * Gemini CLI reads from stdin when piped.
 */
export class GeminiExecutor implements RunnerExecutor {
  readonly name = 'gemini-cli';

  async isAvailable(): Promise<boolean> {
    return commandExists('gemini');
  }

  async run(promptPath: string, cwd: string, timeoutMs = DEFAULT_TIMEOUT, model?: string): Promise<RunnerResult> {
    const prompt = await fs.readFile(promptPath, 'utf8');

    const args: string[] = [];
    if (model) args.push('--model', model);

    const { stdout, stderr, exitCode, durationMs } = await spawnCapture(
      'gemini',
      args,
      prompt,
      cwd,
      timeoutMs
    );

    return {
      output: stdout,
      exitCode,
      tokensUsed: 0, // Gemini CLI doesn't report tokens in stdout
      costUsd: 0,
      error: exitCode !== 0 ? (stderr || stdout).slice(0, 500) : undefined,
      durationMs,
    };
  }
}

// ─── Codex CLI ──────────────────────────────────────────────────────

/**
 * Executes prompts via OpenAI `codex` CLI.
 */
export class CodexExecutor implements RunnerExecutor {
  readonly name = 'codex-cli';

  async isAvailable(): Promise<boolean> {
    return commandExists('codex');
  }

  async run(promptPath: string, cwd: string, timeoutMs = DEFAULT_TIMEOUT, model?: string): Promise<RunnerResult> {
    const prompt = await fs.readFile(promptPath, 'utf8');

    const args = ['--quiet'];
    if (model) args.push('--model', model);

    const { stdout, stderr, exitCode, durationMs } = await spawnCapture(
      'codex',
      args,
      prompt,
      cwd,
      timeoutMs
    );

    return {
      output: stdout,
      exitCode,
      tokensUsed: 0,
      costUsd: 0,
      error: exitCode !== 0 ? (stderr || stdout).slice(0, 500) : undefined,
      durationMs,
    };
  }
}

// ─── Manual (fallback) ──────────────────────────────────────────────

/**
 * No CLI available — just prints the prompt path for manual execution.
 * Returns immediately with empty output. The user handles execution.
 */
export class ManualExecutor implements RunnerExecutor {
  readonly name = 'manual';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(_promptPath: string, _cwd?: string, _timeoutMs?: number, _model?: string): Promise<RunnerResult> {
    return {
      output: '',
      exitCode: 0,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: 0,
    };
  }
}

// ─── Factory ────────────────────────────────────────────────────────

const EXECUTOR_MAP: Record<string, () => RunnerExecutor> = {
  'claude-code': () => new ClaudeExecutor(),
  'claude':      () => new ClaudeExecutor(),
  'gemini-cli':  () => new GeminiExecutor(),
  'gemini':      () => new GeminiExecutor(),
  'codex-cli':   () => new CodexExecutor(),
  'codex':       () => new CodexExecutor(),
};

/**
 * Create the right executor for the configured runner.
 * Falls back to ManualExecutor if the CLI isn't installed.
 */
export async function createExecutor(runner: string): Promise<RunnerExecutor> {
  const key = runner.toLowerCase().replace(/[\s_]/g, '-');

  // Try exact match
  const factory = EXECUTOR_MAP[key];
  if (factory) {
    const executor = factory();
    if (await executor.isAvailable()) return executor;
  }

  // Try prefix match
  for (const [k, f] of Object.entries(EXECUTOR_MAP)) {
    if (key.startsWith(k) || k.startsWith(key)) {
      const executor = f();
      if (await executor.isAvailable()) return executor;
    }
  }

  return new ManualExecutor();
}

// ─── Utilities ──────────────────────────────────────────────────────

/**
 * Rough estimate: tokens from cost.
 * Claude Sonnet ~$3/MTok input + $15/MTok output.
 * Using blended rate of ~$9/MTok as rough average.
 */
function estimateTokensFromCost(costUsd: number): number {
  if (costUsd <= 0) return 0;
  return Math.round(costUsd / 0.000009);
}
