// ─── Prompt Compiler Types ───

export interface PromptInput {
  agentId: string;
  taskId: string;
  contextFiles?: string[];
  module?: string;
  sessionId?: string;
  promptCount?: number;
  runner?: string;
}

export interface PromptSection {
  name: string;
  content: string;
  priority: number;
  tokens: number;
}

export interface BracketConfig {
  bracket: import('./session.js').ContextBracket;
  minPercent: number;
  maxPercent: number;
  tokenBudget: number;
  includeSessionHistory: boolean;
  includeArtifactIndex: boolean;
  includeGotchas: boolean;
  handoffWarning: boolean;
}
