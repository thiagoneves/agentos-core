// ─── Model Profile Resolution ───
//
// Maps (runner × profile × agent role) → concrete model ID.
// Each runner has its own model tiers. The profile selects a
// cost/quality trade-off, and the agent role determines which
// tier applies (planning needs the best model, verification can
// use a lighter one).

export type ModelTier = 'planning' | 'execution' | 'research' | 'verification';
export type ModelProfile = 'quality' | 'balanced' | 'budget';

interface TierMap {
  planning: string;
  execution: string;
  research: string;
  verification: string;
}

// ─── Runner Model Maps ───

const CLAUDE: Record<ModelProfile, TierMap> = {
  quality: {
    planning:     'claude-opus-4-6',
    execution:    'claude-opus-4-6',
    research:     'claude-sonnet-4-6',
    verification: 'claude-sonnet-4-6',
  },
  balanced: {
    planning:     'claude-opus-4-6',
    execution:    'claude-sonnet-4-6',
    research:     'claude-sonnet-4-6',
    verification: 'claude-haiku-4-5-20251001',
  },
  budget: {
    planning:     'claude-sonnet-4-6',
    execution:    'claude-sonnet-4-6',
    research:     'claude-haiku-4-5-20251001',
    verification: 'claude-haiku-4-5-20251001',
  },
};

const GEMINI: Record<ModelProfile, TierMap> = {
  quality: {
    planning:     'gemini-2.5-pro',
    execution:    'gemini-2.5-pro',
    research:     'gemini-2.5-pro',
    verification: 'gemini-2.5-flash',
  },
  balanced: {
    planning:     'gemini-2.5-pro',
    execution:    'gemini-2.5-flash',
    research:     'gemini-2.5-flash',
    verification: 'gemini-2.0-flash-lite',
  },
  budget: {
    planning:     'gemini-2.5-flash',
    execution:    'gemini-2.5-flash',
    research:     'gemini-2.0-flash-lite',
    verification: 'gemini-2.0-flash-lite',
  },
};

const CODEX: Record<ModelProfile, TierMap> = {
  quality: {
    planning:     'o3',
    execution:    'o3',
    research:     'o4-mini',
    verification: 'o4-mini',
  },
  balanced: {
    planning:     'o3',
    execution:    'o4-mini',
    research:     'o4-mini',
    verification: 'o4-mini',
  },
  budget: {
    planning:     'o4-mini',
    execution:    'o4-mini',
    research:     'o4-mini',
    verification: 'o4-mini',
  },
};

// ─── Runner → Map lookup ───

const RUNNER_MODELS: Record<string, Record<ModelProfile, TierMap>> = {
  'claude-code': CLAUDE,
  'claude':      CLAUDE,
  'gemini-cli':  GEMINI,
  'gemini':      GEMINI,
  'codex-cli':   CODEX,
  'codex':       CODEX,
};

// ─── Agent Role → Model Tier ───

const ROLE_TIER: Record<string, ModelTier> = {
  'planner':    'planning',
  'architect':  'planning',
  'pm':         'planning',
  'analyst':    'research',
  'researcher': 'research',
  'developer':  'execution',
  'dev':        'execution',
  'builder':    'execution',
  'executor':   'execution',
  'qa':         'verification',
  'verifier':   'verification',
  'reviewer':   'verification',
  'doctor':     'verification',
  'maintainer': 'execution',
};

/**
 * Classify an agent name/role into a model tier.
 * Falls back to 'execution' for unknown agents.
 */
export function classifyTier(agentId: string): ModelTier {
  const name = agentId.replace(/^@/, '').toLowerCase();

  // Exact match
  if (ROLE_TIER[name]) return ROLE_TIER[name];

  // Partial match (e.g. "lead-developer" contains "developer")
  for (const [keyword, tier] of Object.entries(ROLE_TIER)) {
    if (name.includes(keyword)) return tier;
  }

  return 'execution';
}

/**
 * Resolve the concrete model ID for a given runner, profile, and agent.
 *
 * Resolution order:
 * 1. model_overrides (user explicit override for this agent)
 * 2. Runner × Profile × Tier from the model map
 * 3. undefined (runner not in map → executor uses its default)
 */
export function resolveModel(
  runner: string,
  profile: ModelProfile,
  agentId: string,
  overrides?: Record<string, string>,
): string | undefined {
  // 1. User override takes precedence
  const normalizedAgent = agentId.replace(/^@/, '').toLowerCase();
  if (overrides) {
    const override = overrides[agentId] || overrides[normalizedAgent] || overrides[`@${normalizedAgent}`];
    if (override) return override;
  }

  // 2. Lookup runner map
  const runnerKey = runner.toLowerCase().replace(/[\s_]/g, '-');
  const runnerMap = RUNNER_MODELS[runnerKey];
  if (!runnerMap) return undefined;

  const profileMap = runnerMap[profile];
  if (!profileMap) return undefined;

  // 3. Classify agent → tier → model
  const tier = classifyTier(agentId);
  return profileMap[tier];
}
