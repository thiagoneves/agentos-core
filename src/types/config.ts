import { z } from 'zod';

// ─── Project Config ───
export const ModelProfileSchema = z.enum(['quality', 'balanced', 'budget']).default('balanced');

export const ProjectConfigSchema = z.object({
  name: z.string(),
  state: z.enum(['greenfield', 'brownfield']).default('brownfield'),
  output_language: z.string().default('English'),
  runner: z.string().default('Auto-detect'),
  model_profile: ModelProfileSchema,
  model_overrides: z.record(z.string(), z.string()).optional(),
});

export const EngineeringConfigSchema = z.object({
  stack: z.array(z.string()).default([]),
  testing_policy: z.enum(['tdd', 'post', 'none']).default('post'),
  autonomy: z.enum(['strict', 'balanced', 'full']).default('balanced'),
  commit_pattern: z.enum(['conventional', 'none']).default('conventional'),
});

export const ModuleInfoSchema = z.object({
  name: z.string(),
  version: z.string().default('1.0.0'),
  source: z.enum(['registry', 'github', 'local']).default('local'),
});

export const AgentOSConfigSchema = z.object({
  version: z.string().default('1.0'),
  project: ProjectConfigSchema,
  engineering: EngineeringConfigSchema,
  modules: z.object({
    installed: z.array(ModuleInfoSchema).default([]),
  }),
  settings: z.object({
    tokens: z.object({
      context_budget: z.string().default('50%'),
      summary_max_lines: z.number().default(50),
      index_enabled: z.boolean().default(true),
    }),
    git: z.object({
      auto_commit: z.boolean().default(true),
      commit_prefix: z.string().default('aos'),
    }),
    session: z.object({
      crash_detection_minutes: z.number().default(30),
      max_events: z.number().default(200),
    }).default({ crash_detection_minutes: 30, max_events: 200 }),
  }),
  registry: z.object({
    url: z.string().default(
      'https://raw.githubusercontent.com/thiagoneves/agentos-modules/main/registry.yaml'
    ),
  }).default({
    url: 'https://raw.githubusercontent.com/thiagoneves/agentos-modules/main/registry.yaml',
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type EngineeringConfig = z.infer<typeof EngineeringConfigSchema>;
export type ModuleInfo = z.infer<typeof ModuleInfoSchema>;
export type AgentOSConfig = z.infer<typeof AgentOSConfigSchema>;
