// ─── Gotchas Memory Types ───

export interface Gotcha {
  pattern: string;
  message: string;
  agent: string;
  domain: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
}
