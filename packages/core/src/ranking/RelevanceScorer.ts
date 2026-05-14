import type { MemoryEntry } from "../types/MemoryEntry";
import type { Confidence, MemoryType } from "../types/MemoryCandidate";
import { ConflictDetector, type ConflictAnnotation } from "../deduplication/ConflictDetector";

export const rankingStrategies = ["context", "search"] as const;
export type RankingStrategy = (typeof rankingStrategies)[number];

export interface ScoredMemory {
  readonly entry: MemoryEntry;
  readonly score: number;
  readonly conflicts?: readonly ConflictAnnotation[];
}

/** Weight profile for each scoring signal. Values should sum to 1.0. */
interface WeightProfile {
  readonly queryOverlap: number;
  readonly typeBias: number;
  readonly confidence: number;
  readonly recency: number;
  readonly tagMatch: number;
  readonly scopeMatch: number;
}

const strategyWeights: Record<RankingStrategy, WeightProfile> = {
  context: {
    queryOverlap: 0.25,
    typeBias: 0.25,
    confidence: 0.15,
    recency: 0.10,
    tagMatch: 0.10,
    scopeMatch: 0.15,
  },
  search: {
    queryOverlap: 0.50,
    typeBias: 0.05,
    confidence: 0.10,
    recency: 0.10,
    tagMatch: 0.15,
    scopeMatch: 0.10,
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
 * Build bigrams (consecutive token pairs) from an ordered token array.
 * E.g. ["react", "hooks", "pattern"] => ["react hooks", "hooks pattern"]
 */
export function bigrams(tokens: readonly string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    result.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return result;
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
 * @param queryScope   Optional scope to boost scope-matching entries.
 */
export function scoreEntry(
  entry: MemoryEntry,
  queryTokens: readonly string[],
  strategy: RankingStrategy,
  referenceMs: number,
  queryScope?: string,
): number {
  const weights = strategyWeights[strategy];

  // --- Query overlap (exact + substring + bigram) ---
  let queryOverlap = 0;
  if (queryTokens.length > 0) {
    const haystack = tokenize(
      [entry.content, entry.type, entry.scope, entry.reason, ...entry.tags].join(" "),
    );
    const haystackSet = new Set(haystack);

    // Exact and partial (substring) unigram matching.
    // Both tokens must be >= 3 chars for substring checks to avoid false positives
    // with short tokens like "a", "i", "t" that appear inside most words.
    const PARTIAL_WEIGHT = 0.5;
    const MIN_SUBSTRING_LEN = 3;
    let unigramScore = 0;
    for (const token of queryTokens) {
      if (haystackSet.has(token)) {
        unigramScore += 1;
      } else if (token.length >= MIN_SUBSTRING_LEN) {
        // Check substring: query token contained within a haystack token, or vice versa
        let foundPartial = false;
        for (const h of haystack) {
          if (h.length >= MIN_SUBSTRING_LEN && (h.includes(token) || token.includes(h))) {
            foundPartial = true;
            break;
          }
        }
        if (foundPartial) {
          unigramScore += PARTIAL_WEIGHT;
        }
      }
    }
    const unigramFraction = unigramScore / queryTokens.length;

    // Bigram matching: blend for consecutive token pairs found in the haystack
    const queryBigrams = bigrams(queryTokens);
    if (queryBigrams.length > 0) {
      const haystackBigrams = new Set(bigrams(haystack));
      let bigramMatched = 0;
      for (const bg of queryBigrams) {
        if (haystackBigrams.has(bg)) {
          bigramMatched++;
        }
      }
      const bigramFraction = bigramMatched / queryBigrams.length;
      // Blend: 80% unigram + 20% bigram phrase proximity
      queryOverlap = unigramFraction * 0.8 + bigramFraction * 0.2;
    } else {
      // Single-token query — no bigrams possible, use pure unigram score
      queryOverlap = unigramFraction;
    }
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

  // --- Scope match ---
  let scopeMatch: number;
  if (queryScope === undefined) {
    // No scope filter — all memories are equally relevant for scope.
    scopeMatch = 1;
  } else if (entry.scope === queryScope) {
    scopeMatch = 1;
  } else if (entry.scope === "global") {
    scopeMatch = 0.5;
  } else {
    scopeMatch = 0;
  }

  return (
    weights.queryOverlap * queryOverlap +
    weights.typeBias * typeBias +
    weights.confidence * conf +
    weights.recency * recency +
    weights.tagMatch * tagMatch +
    weights.scopeMatch * scopeMatch
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
 * @param queryScope     Optional scope to boost scope-matching entries.
 */
export function rankMemories(
  entries: readonly MemoryEntry[],
  query: string,
  strategy: RankingStrategy,
  referenceTime?: string,
  queryScope?: string,
): ScoredMemory[] {
  const queryTokens = tokenize(query);
  const referenceMs = referenceTime
    ? new Date(referenceTime).getTime()
    : Date.now();

  return entries
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, queryTokens, strategy, referenceMs, queryScope),
    }))
    .sort((a, b) => {
      const diff = b.score - a.score;
      if (Math.abs(diff) > 1e-9) return diff;
      // Tie-break: most recently updated first.
      return b.entry.updatedAt.localeCompare(a.entry.updatedAt);
    });
}

/**
 * Run conflict detection on already-ranked memories and attach annotations.
 *
 * Entries without conflicts are returned unchanged (no `conflicts` field).
 * This is designed to be called after `rankMemories` on the final top-N slice
 * so the pairwise comparison cost stays bounded.
 */
export function annotateConflicts(scored: readonly ScoredMemory[]): ScoredMemory[] {
  if (scored.length < 2) {
    return scored.map((s) => ({ entry: s.entry, score: s.score }));
  }

  const detector = new ConflictDetector();
  const entries = scored.map((s) => s.entry);
  const conflictMap = detector.findConflictsAmong(entries);

  return scored.map((s) => {
    const annotations = conflictMap.get(s.entry.id);
    if (annotations && annotations.length > 0) {
      return { entry: s.entry, score: s.score, conflicts: annotations };
    }
    return { entry: s.entry, score: s.score };
  });
}
