// ─── Runner Types ───

export interface RunnerResult {
  output: string;
  exitCode: number;
  tokensUsed: number;
  costUsd: number;
  error?: string;
  durationMs: number;
}

export interface RunnerExecutor {
  readonly name: string;
  run(promptPath: string, cwd: string, timeoutMs?: number, model?: string): Promise<RunnerResult>;
  isAvailable(): Promise<boolean>;
}
