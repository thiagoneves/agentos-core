import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import type { AgentOSConfig, PromptInput, PromptSection } from '../types/index.js';
import { ArtifactManager } from './artifact-manager.js';
import { Summarizer } from './summarizer.js';
import { consumeContinueHere } from './session-continuity.js';
import { GotchasMemory } from './gotchas-memory.js';
import {
  getBracket,
  getMaxContextForRunner,
  estimateTokens,
  enforceTokenBudget,
  SectionPriority,
} from './context-tracker.js';

export interface PromptCompilerDeps {
  artifactManager?: ArtifactManager;
  summarizer?: Summarizer;
  gotchas?: GotchasMemory;
}

export class PromptCompiler {
  private agentosDir: string;
  private artifactManager: ArtifactManager;
  private summarizer: Summarizer;
  private gotchas: GotchasMemory;

  constructor(baseDir: string = process.cwd(), deps?: PromptCompilerDeps) {
    this.agentosDir = path.join(baseDir, '.agentos');
    this.artifactManager = deps?.artifactManager ?? new ArtifactManager(baseDir);
    this.summarizer = deps?.summarizer ?? new Summarizer(baseDir);
    this.gotchas = deps?.gotchas ?? new GotchasMemory(baseDir);
  }

  async compile(input: PromptInput, config: AgentOSConfig): Promise<string> {
    const { agentId, taskId, contextFiles = [], module = 'sdlc', sessionId, promptCount = 0, runner } = input;

    const maxContext = runner ? getMaxContextForRunner(runner) : undefined;
    const bracket = getBracket(promptCount, maxContext);

    await this.artifactManager.syncIndex();

    const agentData = await this.resolveComponent('agents', agentId, module);
    const taskData = await this.resolveComponent('tasks', taskId, module);

    const sections: PromptSection[] = [
      {
        name: 'header',
        content: `<!-- COMPILED PROMPT — AgentOS v1.0 | bracket: ${bracket.bracket} -->`,
        priority: SectionPriority.AGENT,
        tokens: 0,
      },
      {
        name: 'agent',
        content: `<system>\n${agentData.body}\n</system>`,
        priority: SectionPriority.AGENT,
        tokens: estimateTokens(agentData.body),
      },
      {
        name: 'rules',
        content: await this.assembleRules(module),
        priority: SectionPriority.RULES,
        tokens: 0,
      },
      {
        name: 'task',
        content: `<task>\n${taskData.body}\n</task>`,
        priority: SectionPriority.TASK,
        tokens: estimateTokens(taskData.body),
      },
      {
        name: 'context',
        content: await this.assembleContext(contextFiles, config),
        priority: SectionPriority.CONTEXT_FILES,
        tokens: 0,
      },
      {
        name: 'output_constraints',
        content: this.assembleOutputConstraints(config),
        priority: SectionPriority.OUTPUT_CONSTRAINTS,
        tokens: 0,
      },
    ];

    if (bracket.includeSessionHistory) {
      const sessionCtx = await this.assembleSessionContext(sessionId);
      if (sessionCtx) {
        sections.push({
          name: 'session_history',
          content: sessionCtx,
          priority: SectionPriority.SESSION_HISTORY,
          tokens: estimateTokens(sessionCtx),
        });
      }
    }

    if (bracket.includeSessionHistory) {
      const continueHere = await this.assembleContinueHere();
      if (continueHere) {
        sections.push({
          name: 'continue_here',
          content: continueHere,
          priority: SectionPriority.CONTINUE_HERE,
          tokens: estimateTokens(continueHere),
        });
      }
    }

    if (bracket.includeArtifactIndex) {
      const artifactIndex = await this.assembleArtifactIndex();
      if (artifactIndex) {
        sections.push({
          name: 'artifact_index',
          content: artifactIndex,
          priority: SectionPriority.ARTIFACT_INDEX,
          tokens: estimateTokens(artifactIndex),
        });
      }
    }

    if (bracket.includeGotchas) {
      const gotchaHints = await this.assembleGotchas(agentId);
      if (gotchaHints) {
        sections.push({
          name: 'gotchas',
          content: gotchaHints,
          priority: SectionPriority.GOTCHAS,
          tokens: estimateTokens(gotchaHints),
        });
      }
    }

    if (bracket.handoffWarning) {
      const warning = '<handoff_warning>\nContext window is critically low. Wrap up current task and prepare a handoff summary.\n</handoff_warning>';
      sections.push({
        name: 'handoff_warning',
        content: warning,
        priority: SectionPriority.AGENT, // protected — always included
        tokens: estimateTokens(warning),
      });
    }

    for (const s of sections) {
      if (s.tokens === 0 && s.content.length > 0) {
        s.tokens = estimateTokens(s.content);
      }
    }

    const finalSections = enforceTokenBudget(sections, bracket.tokenBudget);
    const finalPrompt = finalSections.map(s => s.content).join('\n\n');

    const compiledDir = path.join(this.agentosDir, 'compiled');
    await fs.mkdir(compiledDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(compiledDir, `${taskId}-${timestamp}.prompt.md`);
    await fs.writeFile(outputPath, finalPrompt, 'utf8');

    return outputPath;
  }

  private async assembleSessionContext(sessionId?: string): Promise<string> {
    if (!sessionId) return '';
    const summary = await this.summarizer.getLatestSummary(sessionId);
    if (!summary) return '';
    return `<session_history>\n${summary}\n</session_history>`;
  }

  private async assembleContinueHere(): Promise<string> {
    const content = await consumeContinueHere(this.agentosDir);
    if (!content) return '';
    return `<continue_here>\n${content}\n</continue_here>`;
  }

  private async assembleArtifactIndex(): Promise<string> {
    const index = await this.artifactManager.getIndexContent();
    if (!index || index.trim().length === 0) return '';
    return `<artifact_index>\n${index}\n</artifact_index>`;
  }

  private async assembleGotchas(agentId: string): Promise<string> {
    const hints = await this.gotchas.getRelevantGotchas(agentId);
    if (!hints) return '';
    return `<gotchas>\nKnown issues — avoid repeating these errors:\n${hints}\n</gotchas>`;
  }

  private async resolveComponent(type: 'agents' | 'tasks', id: string, module: string) {
    const corePath = path.join(this.agentosDir, 'core', type, `${id}.md`);
    try {
      return await this.loadMarkdownFile(corePath);
    } catch {
      const modulePath = path.join(this.agentosDir, 'modules', module, type, `${id}.md`);
      return await this.loadMarkdownFile(modulePath);
    }
  }

  private async loadMarkdownFile(filePath: string) {
    const content = await fs.readFile(filePath, 'utf8');
    const parts = content.split('---');

    if (parts.length < 3) {
      return { frontmatter: {}, body: content };
    }

    return {
      frontmatter: YAML.parse(parts[1] || ''),
      body: parts.slice(2).join('---').trim()
    };
  }

  private async assembleRules(module: string): Promise<string> {
    let rulesStr = '<rules>\n';

    const coreRulesDir = path.join(this.agentosDir, 'core', 'rules');
    rulesStr += await this.loadRulesFromDir(coreRulesDir);

    const moduleRulesDir = path.join(this.agentosDir, 'modules', module, 'rules');
    rulesStr += await this.loadRulesFromDir(moduleRulesDir);

    rulesStr += '</rules>';
    return rulesStr;
  }

  private async loadRulesFromDir(dir: string): Promise<string> {
    let result = '';
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = await fs.readFile(path.join(dir, file), 'utf8');
          result += `## Rule: ${file}\n${content}\n\n`;
        }
      }
    } catch { /* no rules dir */ }
    return result;
  }

  private async assembleContext(files: string[], _config: AgentOSConfig): Promise<string> {
    let contextStr = '<context>\n';

    const projectContextPath = path.join(this.agentosDir, 'artifacts', '00-context.md');
    try {
      const projectContext = await fs.readFile(projectContextPath, 'utf8');
      contextStr += `## Project Rules & Identity\n${projectContext}\n\n`;
    } catch { /* no project context yet */ }

    for (const file of files) {
      try {
        const fullPath = path.isAbsolute(file) ? file : path.join(path.dirname(this.agentosDir), file);
        const content = await fs.readFile(fullPath, 'utf8');
        contextStr += `## File: ${file}\n\`\`\`\n${content}\n\`\`\`\n\n`;
      } catch {
        contextStr += `## File: ${file}\n(File not found or inaccessible)\n\n`;
      }
    }

    contextStr += '</context>';
    return contextStr;
  }

  private assembleOutputConstraints(config: AgentOSConfig): string {
    return `<output_constraints>
- LANGUAGE: All documentation, comments in code, and summaries MUST be written in ${config.project.output_language}.
- FORMAT: Use structured tags like FILE: [path], PATCH: [path], or SUMMARY: [text] when applicable.
</output_constraints>`;
  }
}
