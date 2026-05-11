import type { MemoryEntry } from "../types/MemoryEntry";
import type { Confidence, MemoryType } from "../types/MemoryCandidate";

export const rankingStrategies = ["context", "search"] as const;
export type RankingStrategy = (typeof rankingStrategies)[number];

export interface ScoredMemory {
  readonly entry: MemoryEntry;
  readonly score: number;
}

/** Weight profile for each scoring signal. Values should sum to 1.0. */
interface WeightProfile {
  readonly queryOverlap: number;
  readonly typeBias: number;
  readonly confidence: number;
  readonly recency: number;
  readonly tagMatch: number;
}

const strategyWeights: Record<RankingStrategy, WeightProfile> = {
  context: {
    queryOverlap: 0.30,
    typeBias: 0.30,
    confidence: 0.15,
    recency: 0.15,
    tagMatch: 0.10,
  },
  search: {
    queryOverlap: 0.55,
    typeBias: 0.05,
    confidence: 0.10,
    recency: 0.15,
    tagMatch: 0.15,
  },
};

/**
 * Type bias scores for the "context" strategy.
 * Rules and gotchas that affect future coding rank highest.
 */
const contextTypeBias: Record<MemoryType, number> = {
  coding_rule: 1.0,
  known_gotcha: 1.0,
  forbidden_pattern: 1.0,
  testing_rule: 0.8,
  security_rule: 0.8,
  deployment_rule: 0.8,
  architecture_decision: 0.7,
  project_fact: 0.4,
  domain_knowledge: 0.4,
  session_summary: 0.1,
};

/**
 * Type bias scores for the "search" strategy.
 * Nearly flat so text relevance dominates.
 */
const searchTypeBias: Record<MemoryType, number> = {
  coding_rule: 0.5,
  known_gotcha: 0.5,
  forbidden_pattern: 0.5,
  testing_rule: 0.5,
  security_rule: 0.5,
  deployment_rule: 0.5,
  architecture_decision: 0.5,
  project_fact: 0.5,
  domain_knowledge: 0.5,
  session_summary: 0.5,
};

const typeBiasMap: Record<RankingStrategy, Record<MemoryType, number>> = {
  context: contextTypeBias,
  search: searchTypeBias,
};

const confidenceScore: Record<Confidence, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.2,
};

/** Half-life for recency decay in milliseconds (~90 days). */
const RECENCY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Tokenize a string into lowercase alphanumeric tokens for matching.
 * Matches the tokenizer used by `JsonMemoryStore.search`.
 */
export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Compute a relevance score for a single memory entry against a query.
 *
 * Each signal is normalized to [0, 1] and combined using the weight profile
 * for the given strategy. The result is a score in [0, 1].
 *
 * @param entry        The memory entry to score.
 * @param queryTokens  Pre-tokenized query tokens.
 * @param strategy     Ranking strategy: "context" for opinionated coding utility,
 *                     "search" for precision / recall.
 * @param referenceMs  Reference timestamp in epoch ms (for deterministic recency in tests).
 */
export function scoreEntry(
  entry: MemoryEntry,
  queryTokens: readonly string[],
  strategy: RankingStrategy,
  referenceMs: number,
): number {
  const weights = strategyWeights[strategy];

  // --- Query overlap ---
  let queryOverlap = 0;
  if (queryTokens.length > 0) {
    const haystack = tokenize([entry.content, entry.type, entry.scope, ...entry.tags].join(" "));
    const haystackSet = new Set(haystack);
    let matched = 0;
    for (const token of queryTokens) {
      if (haystackSet.has(token)) {
        matched++;
      }
    }
    queryOverlap = matched / queryTokens.length;
  } else {
    // No query — all memories are equally relevant for text matching.
    queryOverlap = 1;
  }

  // --- Type bias ---
  const typeBias = typeBiasMap[strategy][entry.type];

  // --- Confidence ---
  const conf = confidenceScore[entry.confidence];

  // --- Recency ---
  const entryMs = new Date(entry.updatedAt).getTime();
  const ageMs = Math.max(0, referenceMs - entryMs);
  const recency = Math.pow(2, -ageMs / RECENCY_HALF_LIFE_MS);

  // --- Tag match ---
  let tagMatch = 0;
  if (queryTokens.length > 0 && entry.tags.length > 0) {
    const tagTokens = new Set(entry.tags.map((tag) => tag.toLowerCase()));
    let matched = 0;
    for (const token of queryTokens) {
      if (tagTokens.has(token)) {
        matched++;
      }
    }
    tagMatch = matched / queryTokens.length;
  }

  return (
    weights.queryOverlap * queryOverlap +
    weights.typeBias * typeBias +
    weights.confidence * conf +
    weights.recency * recency +
    weights.tagMatch * tagMatch
  );
}

/**
 * Rank memory entries by relevance to a query using the specified strategy.
 *
 * Returns entries sorted by descending relevance score. Ties are broken by
 * `updatedAt` descending to keep ordering deterministic.
 *
 * @param entries        Entries to rank (already filtered by the store).
 * @param query          Raw query string.
 * @param strategy       "context" for opinionated coding utility, "search" for precision / recall.
 * @param referenceTime  ISO timestamp for recency calculation (defaults to now).
 */
export function rankMemories(
  entries: readonly MemoryEntry[],
  query: string,
  strategy: RankingStrategy,
  referenceTime?: string,
): ScoredMemory[] {
  const queryTokens = tokenize(query);
  const referenceMs = referenceTime
    ? new Date(referenceTime).getTime()
    : Date.now();

  return entries
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, queryTokens, strategy, referenceMs),
    }))
    .sort((a, b) => {
      const diff = b.score - a.score;
      if (Math.abs(diff) > 1e-9) return diff;
      // Tie-break: most recently updated first.
      return b.entry.updatedAt.localeCompare(a.entry.updatedAt);
    });
}
