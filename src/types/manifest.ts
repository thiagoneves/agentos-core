import { z } from 'zod';

// ─── Module Manifest (module.yaml) ───
export const ModuleManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  license: z.string().optional(),
  domain: z.string().optional(),
  tags: z.array(z.string()).default([]),
  agentos: z.object({
    min_version: z.string().default('1.0.0'),
  }).optional(),
  depends_on: z.array(z.object({
    name: z.string(),
    version: z.string().optional(),
  })).default([]),
  agents: z.array(z.string()).default([]),
  tasks: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  workflows: z.array(z.string()).default([]),
  templates: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  squads: z.record(z.string(), z.array(z.string())).optional(),
});

export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

// ─── Manifest Lock ───
export const ManifestLockSchema = z.object({
  version: z.string().default('1.0'),
  generated: z.string(),
  modules: z.record(z.string(), z.object({
    version: z.string(),
    source: z.string(),
    integrity: z.string().optional(),
    installed: z.string(),
  })),
});

export type ManifestLock = z.infer<typeof ManifestLockSchema>;
