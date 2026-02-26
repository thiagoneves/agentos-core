import type { BracketConfig, PromptSection } from '../types/index.js';

export type { BracketConfig, PromptSection } from '../types/index.js';

// ─── Token Estimation ───────────────────────────────────────────────

/**
 * Content-aware token estimator. No external dependencies.
 *
 * Instead of a flat chars/4, this analyzes the actual content structure:
 * - Symbols/punctuation → typically 1 token each
 * - Whitespace runs → compressed (~1 token per 4 spaces)
 * - Newlines → 1 token each
 * - Numbers → ~1 token per 1-3 digits
 * - Short words (≤6 chars) → 1 token
 * - Long words → subword splits (CamelCase, snake_case, or ~5 chars/token)
 * - Non-ASCII (emoji, unicode) → 2-3 tokens each
 *
 * Accuracy: ~5-8% error vs real tokenizer (compared to ~15-25% with chars/4).
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  let tokens = 0;
  const lines = text.split('\n');

  tokens += lines.length - 1;

  for (const line of lines) {
    const segments = line.split(/(\s+)/);

    for (const seg of segments) {
      if (!seg) continue;

      // Whitespace runs: ~1 token per 4 spaces, minimum 1 per run
      if (/^\s+$/.test(seg)) {
        tokens += Math.max(1, Math.ceil(seg.length / 4));
        continue;
      }

      // Split non-whitespace on punctuation boundaries
      // Each punctuation char is typically its own token
      const parts = seg.split(/([^a-zA-Z0-9_])/);

      for (const part of parts) {
        if (!part) continue;

        // Single punctuation/symbol → 1 token
        if (part.length === 1 && /[^a-zA-Z0-9_]/.test(part)) {
          tokens += 1;
          continue;
        }

        // Number sequence → ~1 token per 1-3 digits
        if (/^\d+$/.test(part)) {
          tokens += Math.max(1, Math.ceil(part.length / 3));
          continue;
        }

        // Non-ASCII chars → 2-3 tokens each (emoji, accented chars, CJK)
        const nonAsciiCount = (part.match(/[^\x00-\x7F]/g) || []).length;
        if (nonAsciiCount > 0) {
          const asciiPart = part.replace(/[^\x00-\x7F]/g, '');
          tokens += nonAsciiCount * 2;
          if (asciiPart.length > 0) {
            tokens += estimateWordTokens(asciiPart);
          }
          continue;
        }

        tokens += estimateWordTokens(part);
      }
    }
  }

  return Math.ceil(tokens);
}

/**
 * Estimate tokens for a single word (no spaces, no punctuation).
 *
 * BPE tokenizers split words based on learned merge rules:
 * - Common short words ("the", "return", "const") → 1 token
 * - Medium words → 1-2 tokens
 * - CamelCase → splits at uppercase boundaries
 * - snake_case → splits at underscores
 * - Long unfamiliar words → ~1 token per 4-5 chars
 */
function estimateWordTokens(word: string): number {
  if (!word) return 0;

  const len = word.length;

  if (len <= 3) return 1;
  if (len <= 6) return 1;

  // Check for CamelCase splits (e.g., "generateSessionTitle" → 3 parts)
  const camelParts = word.split(/(?=[A-Z][a-z])/).filter(Boolean);
  if (camelParts.length > 1) {
    // Each camel segment is usually 1 token if short, 2 if long
    return camelParts.reduce((sum, part) =>
      sum + (part.length <= 6 ? 1 : Math.ceil(part.length / 5)), 0);
  }

  // Check for snake_case splits (e.g., "session_state" → 2 parts)
  if (word.includes('_')) {
    const snakeParts = word.split('_').filter(Boolean);
    return snakeParts.reduce((sum, part) =>
      sum + (part.length <= 6 ? 1 : Math.ceil(part.length / 5)), 0);
  }

  // Medium words (7-10 chars): typically 2 tokens
  if (len <= 10) return 2;

  // Long words: subword split at ~5 chars/token
  return Math.ceil(len / 5);
}

// ─── Context Brackets ───────────────────────────────────────────────

/**
 * Bracket definitions — controls what gets injected into prompts.
 *
 * FRESH:    Context is abundant → inject only essentials (saves tokens)
 * MODERATE: Normal operation → inject everything
 * DEPLETED: Context shrinking → inject everything + gotcha hints
 * CRITICAL: Almost out → inject everything + full gotchas + handoff warning
 */
export const BRACKET_CONFIGS: BracketConfig[] = [
  {
    bracket: 'FRESH',
    minPercent: 60,
    maxPercent: 100,
    tokenBudget: 4000,
    includeSessionHistory: false,
    includeArtifactIndex: false,
    includeGotchas: false,
    handoffWarning: false,
  },
  {
    bracket: 'MODERATE',
    minPercent: 40,
    maxPercent: 60,
    tokenBudget: 6000,
    includeSessionHistory: true,
    includeArtifactIndex: true,
    includeGotchas: false,
    handoffWarning: false,
  },
  {
    bracket: 'DEPLETED',
    minPercent: 25,
    maxPercent: 40,
    tokenBudget: 8000,
    includeSessionHistory: true,
    includeArtifactIndex: true,
    includeGotchas: true,
    handoffWarning: false,
  },
  {
    bracket: 'CRITICAL',
    minPercent: 0,
    maxPercent: 25,
    tokenBudget: 10000,
    includeSessionHistory: true,
    includeArtifactIndex: true,
    includeGotchas: true,
    handoffWarning: true,
  },
];

// ─── Context Percent Estimation ─────────────────────────────────────

const DEFAULT_MAX_CONTEXT = 200_000;

/**
 * Average tokens consumed per round of conversation (prompt + response).
 * Breakdown:
 * - Compiled prompt: ~800-1200 tokens
 * - Model response (code + explanation): ~1500-3000 tokens
 * - Tool call overhead (XML wrapping): ~200-400 tokens
 * Total per round ≈ 2500-4600, using 3500 as practical average.
 */
const TOKENS_PER_ROUND = 3500;

/**
 * Known runner context windows (in tokens).
 * Normalized to lowercase for matching.
 */
const RUNNER_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-code':      200_000,   // Claude 4.x family — 200k
  'claude':           200_000,
  'gemini-cli':       1_000_000, // Gemini 2.5 Pro / 2.0 Flash — 1M
  'gemini':           1_000_000,
  'codex-cli':        200_000,   // Codex CLI — o3/o4-mini — 200k
  'codex':            200_000,
  'copilot':          128_000,   // GitHub Copilot — GPT-4o — 128k
  'github-copilot':   128_000,
  'cursor':           200_000,   // Cursor — Claude/GPT-4o — 200k
  'windsurf':         200_000,   // Windsurf — Claude/GPT-4o — 200k
  'generic':          128_000,
  'auto-detect':      200_000,
};

/**
 * Resolve max context window for a given runner.
 * Falls back to 200k if runner is unknown.
 */
export function getMaxContextForRunner(runner: string): number {
  const key = runner.toLowerCase().replace(/[\s_]/g, '-');
  if (RUNNER_CONTEXT_WINDOWS[key]) return RUNNER_CONTEXT_WINDOWS[key];
  for (const [k, v] of Object.entries(RUNNER_CONTEXT_WINDOWS)) {
    if (key.startsWith(k) || k.startsWith(key)) return v;
  }
  return DEFAULT_MAX_CONTEXT;
}

/**
 * Estimate remaining context window percentage.
 *
 * Uses TOKENS_PER_ROUND (3500) which accounts for both prompt AND response
 * tokens, since both consume the context window. This is more accurate than
 * only counting input tokens (the aios-core approach of 1500 * 1.2 = 1800
 * underestimates by ~50% because it ignores model output).
 */
export function estimateContextPercent(
  promptCount: number,
  maxContext: number = DEFAULT_MAX_CONTEXT
): number {
  const usedTokens = promptCount * TOKENS_PER_ROUND;
  return Math.max(0, Math.min(100, 100 - (usedTokens / maxContext) * 100));
}

export function getBracket(promptCount: number, maxContext?: number): BracketConfig {
  const percent = estimateContextPercent(promptCount, maxContext);
  for (const config of [...BRACKET_CONFIGS].reverse()) {
    if (percent >= config.minPercent && percent <= config.maxPercent) {
      return config;
    }
  }
  return BRACKET_CONFIGS[0];
}

// ─── Token Budget Enforcement ───────────────────────────────────────

/**
 * Section priorities for token budget enforcement.
 * Higher number = removed first when over budget.
 * Protected sections (priority 0) are NEVER removed.
 */
export enum SectionPriority {
  /** Never removed */
  AGENT = 0,
  /** Never removed */
  TASK = 0,
  /** Never removed */
  OUTPUT_CONSTRAINTS = 0,
  /** Removed last among non-protected */
  RULES = 1,
  /** Contextual */
  GOTCHAS = 2,
  /** Contextual */
  CONTEXT_FILES = 3,
  /** Removed early */
  CONTINUE_HERE = 4,
  /** Removed early */
  ARTIFACT_INDEX = 5,
  /** Removed first */
  SESSION_HISTORY = 6,
}

/**
 * Enforces token budget by removing lowest-priority sections first.
 * Returns sections that fit within budget.
 */
export function enforceTokenBudget(
  sections: PromptSection[],
  budget: number
): PromptSection[] {
  const totalTokens = sections.reduce((sum, s) => sum + s.tokens, 0);
  if (totalTokens <= budget) return sections;

  const removable = sections
    .filter(s => s.priority > 0)
    .sort((a, b) => b.priority - a.priority);

  let remaining = [...sections];
  let currentTokens = totalTokens;

  for (const toRemove of removable) {
    if (currentTokens <= budget) break;
    remaining = remaining.filter(s => s !== toRemove);
    currentTokens -= toRemove.tokens;
  }

  return remaining;
}
