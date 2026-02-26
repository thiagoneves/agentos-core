import { z } from 'zod';

// ─── Context Bracket ───
export const ContextBrackets = ['FRESH', 'MODERATE', 'DEPLETED', 'CRITICAL'] as const;
export type ContextBracket = typeof ContextBrackets[number];

// ─── Session State ───
export const SessionEventSchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  agent: z.string(),
  phase: z.string().optional(),
  data: z.any().optional(),
});

export const SessionStateSchema = z.object({
  sessionId: z.string(),
  workflowId: z.string(),
  activeMission: z.string(),
  currentAgent: z.string(),
  currentPhase: z.string(),
  status: z.enum(['idle', 'running', 'paused', 'completed', 'failed']),
  startedAt: z.string(),
  title: z.string().optional(),
  promptCount: z.number().default(0),
  lastActivity: z.string().optional(),
  contextBracket: z.enum(ContextBrackets).default('FRESH'),
  tokens: z.number().default(0),
  costUsd: z.number().default(0),
  events: z.array(SessionEventSchema).default([]),
});

export type SessionEvent = z.infer<typeof SessionEventSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;

// ─── Session Status ───
export type SessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

// ─── Crash Info ───
export interface CrashInfo {
  sessionId: string;
  lastActivity: string;
  minutesSinceActivity: number;
  lastPhase: string;
  lastAgent: string;
}
