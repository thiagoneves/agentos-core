import { describe, it, expect } from 'vitest';
import { getBracket, getMaxContextForRunner, estimateTokens, estimateContextPercent, enforceTokenBudget, SectionPriority } from '../../../src/core/context-tracker.js';

describe('ContextTracker', () => {
  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should estimate simple text', () => {
      const tokens = estimateTokens('Hello world');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should handle code with punctuation', () => {
      const tokens = estimateTokens('const x = 42;');
      expect(tokens).toBeGreaterThan(3);
    });

    it('should handle CamelCase words', () => {
      const tokens = estimateTokens('generateSessionTitle');
      expect(tokens).toBeGreaterThan(1);
    });

    it('should handle multiline text', () => {
      const tokens = estimateTokens('line1\nline2\nline3');
      expect(tokens).toBeGreaterThan(4);
    });
  });

  describe('getBracket', () => {
    it('should return FRESH when prompt count is low', () => {
      // promptCount=1 → 3500/200000 used → ~98% remaining → FRESH (60-100)
      const bracket = getBracket(1, 200_000);
      expect(bracket.bracket).toBe('FRESH');
    });

    it('should return MODERATE at mid usage', () => {
      // promptCount=30 → 105000/200000 used → ~47% remaining → MODERATE (40-60)
      const bracket = getBracket(30, 200_000);
      expect(bracket.bracket).toBe('MODERATE');
    });

    it('should return DEPLETED at high usage', () => {
      // promptCount=40 → 140000/200000 used → ~30% remaining → DEPLETED (25-40)
      const bracket = getBracket(40, 200_000);
      expect(bracket.bracket).toBe('DEPLETED');
    });

    it('should return CRITICAL near limit', () => {
      // promptCount=50 → 175000/200000 used → ~12% remaining → CRITICAL (0-25)
      const bracket = getBracket(50, 200_000);
      expect(bracket.bracket).toBe('CRITICAL');
    });

    it('should include gotchas in DEPLETED bracket', () => {
      const bracket = getBracket(40, 200_000);
      expect(bracket.includeGotchas).toBe(true);
    });

    it('should include handoff warning in CRITICAL bracket', () => {
      const bracket = getBracket(50, 200_000);
      expect(bracket.handoffWarning).toBe(true);
    });
  });

  describe('estimateContextPercent', () => {
    it('should return 100% for zero prompts', () => {
      expect(estimateContextPercent(0, 200_000)).toBe(100);
    });

    it('should decrease with more prompts', () => {
      const p10 = estimateContextPercent(10, 200_000);
      const p20 = estimateContextPercent(20, 200_000);
      expect(p10).toBeGreaterThan(p20);
    });

    it('should never go below 0', () => {
      expect(estimateContextPercent(1000, 200_000)).toBe(0);
    });
  });

  describe('getMaxContextForRunner', () => {
    it('should return correct value for Claude Code', () => {
      expect(getMaxContextForRunner('Claude Code')).toBe(200_000);
    });

    it('should return correct value for Gemini CLI', () => {
      expect(getMaxContextForRunner('Gemini CLI')).toBe(1_000_000);
    });

    it('should return a default for unknown runners', () => {
      expect(getMaxContextForRunner('some-unknown-runner')).toBe(200_000);
    });

    it('should handle Auto-detect', () => {
      expect(getMaxContextForRunner('Auto-detect')).toBe(200_000);
    });
  });

  describe('enforceTokenBudget', () => {
    it('should return all sections if within budget', () => {
      const sections = [
        { name: 'agent', content: 'x', priority: SectionPriority.AGENT, tokens: 100 },
        { name: 'task', content: 'y', priority: SectionPriority.TASK, tokens: 100 },
      ];
      const result = enforceTokenBudget(sections, 500);
      expect(result).toHaveLength(2);
    });

    it('should remove lowest-priority sections first', () => {
      const sections = [
        { name: 'agent', content: 'x', priority: SectionPriority.AGENT, tokens: 100 },
        { name: 'history', content: 'y', priority: SectionPriority.SESSION_HISTORY, tokens: 200 },
        { name: 'index', content: 'z', priority: SectionPriority.ARTIFACT_INDEX, tokens: 150 },
      ];
      const result = enforceTokenBudget(sections, 200);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('agent');
    });

    it('should never remove protected sections', () => {
      const sections = [
        { name: 'agent', content: 'x', priority: SectionPriority.AGENT, tokens: 5000 },
        { name: 'task', content: 'y', priority: SectionPriority.TASK, tokens: 5000 },
      ];
      const result = enforceTokenBudget(sections, 100);
      expect(result).toHaveLength(2);
    });
  });
});
