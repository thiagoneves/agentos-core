import { z } from 'zod';

// ─── Workflow Definition (YAML) ───
export const WorkflowPhaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  agent: z.string(),
  task: z.string(),
  next: z.string().optional(),
  gate: z.enum(['user_approval', 'auto_pass', 'user_acceptance']).optional(),
  decision: z.record(z.string(), z.string()).optional(),
  parallel: z.boolean().optional(),
  skippable: z.boolean().optional(),
  dependsOn: z.array(z.string()).optional(),
  retry: z.number().default(0),
  timeoutMs: z.number().optional(),
});

export const WorkflowDefinitionSchema = z.object({
  workflow: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
  }),
  phases: z.array(WorkflowPhaseSchema),
  flow: z.string().optional(),
});

export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
