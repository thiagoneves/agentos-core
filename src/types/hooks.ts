// ─── Hook System Types ───

export type AgentOSEvent =
  | 'session:start'
  | 'session:complete'
  | 'session:pause'
  | 'session:resume'
  | 'step:start'
  | 'step:complete'
  | 'step:failed'
  | 'artifact:created'
  | 'decision:recorded'
  | 'metrics:update'
  | 'error';

export interface HookData {
  workflowId?: string;
  activeMission?: string;
  stepName?: string;
  task?: string;
  tokens?: number;
  cost?: number;
  currentPhase?: string;
  status?: string;
  error?: string;
  path?: string;
  name?: string;
  [key: string]: unknown;
}

export interface HookPayload {
  sessionId: string;
  agent?: string;
  task?: string;
  data?: HookData;
}
