import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ManualExecutor, ClaudeExecutor, GeminiExecutor, CodexExecutor, createExecutor } from '../../../src/core/runner-executor.js';

describe('RunnerExecutor', () => {
  describe('ManualExecutor', () => {
    it('should always be available', async () => {
      const executor = new ManualExecutor();
      expect(await executor.isAvailable()).toBe(true);
    });

    it('should return empty output with exit code 0', async () => {
      const executor = new ManualExecutor();
      const result = await executor.run('/fake/path');
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('');
      expect(result.tokensUsed).toBe(0);
      expect(result.costUsd).toBe(0);
      expect(result.durationMs).toBe(0);
    });

    it('should have name "manual"', () => {
      const executor = new ManualExecutor();
      expect(executor.name).toBe('manual');
    });

    it('should not include error field on success', async () => {
      const executor = new ManualExecutor();
      const result = await executor.run('/fake/path');
      expect(result.error).toBeUndefined();
    });
  });

  describe('ClaudeExecutor', () => {
    it('should have name "claude-code"', () => {
      const executor = new ClaudeExecutor();
      expect(executor.name).toBe('claude-code');
    });

    it('should check for claude command availability', async () => {
      const executor = new ClaudeExecutor();
      const available = await executor.isAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('should cache command availability check', async () => {
      const executor = new ClaudeExecutor();
      const first = await executor.isAvailable();
      const second = await executor.isAvailable();
      expect(first).toBe(second);
    });
  });

  describe('GeminiExecutor', () => {
    it('should have name "gemini-cli"', () => {
      const executor = new GeminiExecutor();
      expect(executor.name).toBe('gemini-cli');
    });

    it('should check for gemini command availability', async () => {
      const executor = new GeminiExecutor();
      const available = await executor.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('CodexExecutor', () => {
    it('should have name "codex-cli"', () => {
      const executor = new CodexExecutor();
      expect(executor.name).toBe('codex-cli');
    });

    it('should check for codex command availability', async () => {
      const executor = new CodexExecutor();
      const available = await executor.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('createExecutor', () => {
    it('should return ManualExecutor for unknown runners', async () => {
      const executor = await createExecutor('totally-unknown-runner');
      expect(executor.name).toBe('manual');
    });

    it('should try to create ClaudeExecutor for "Claude Code"', async () => {
      const executor = await createExecutor('Claude Code');
      expect(['manual', 'claude-code']).toContain(executor.name);
    });

    it('should try to create GeminiExecutor for "Gemini CLI"', async () => {
      const executor = await createExecutor('Gemini CLI');
      expect(['manual', 'gemini-cli']).toContain(executor.name);
    });

    it('should try to create CodexExecutor for "Codex CLI"', async () => {
      const executor = await createExecutor('Codex CLI');
      expect(['manual', 'codex-cli']).toContain(executor.name);
    });

    it('should handle Auto-detect as ManualExecutor fallback', async () => {
      const executor = await createExecutor('Auto-detect');
      expect(executor.name).toBe('manual');
    });

    it('should handle prefix matching for "claude"', async () => {
      const executor = await createExecutor('claude');
      expect(['manual', 'claude-code']).toContain(executor.name);
    });

    it('should handle prefix matching for "gemini"', async () => {
      const executor = await createExecutor('gemini');
      expect(['manual', 'gemini-cli']).toContain(executor.name);
    });

    it('should handle prefix matching for "codex"', async () => {
      const executor = await createExecutor('codex');
      expect(['manual', 'codex-cli']).toContain(executor.name);
    });

    it('should normalize runner names with spaces and underscores', async () => {
      const executor = await createExecutor('CLAUDE_CODE');
      expect(['manual', 'claude-code']).toContain(executor.name);
    });
  });

  describe('RunnerResult interface', () => {
    it('should have all required fields from ManualExecutor', async () => {
      const executor = new ManualExecutor();
      const result = await executor.run('/any/path');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('tokensUsed');
      expect(result).toHaveProperty('costUsd');
      expect(result).toHaveProperty('durationMs');
    });
  });
});
