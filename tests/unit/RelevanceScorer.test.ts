import { describe, expect, it } from "vitest";
import { rankMemories, scoreEntry, tokenize } from "@openmembrain/core";
import { entry } from "./helpers";

const REF_TIME = "2026-05-08T12:00:00.000Z";
const REF_MS = new Date(REF_TIME).getTime();

describe("tokenize", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenize("React Hooks")).toEqual(["react", "hooks"]);
  });

  it("strips non-alphanumeric characters", () => {
    expect(tokenize("don't use; enums!")).toEqual(["don", "t", "use", "enums"]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("scoreEntry", () => {
  it("returns higher score for entries with more query token overlap", () => {
    const high = entry({ content: "React hooks pattern for state management." });
    const low = entry({ id: "mem_2", content: "Kubernetes deployment uses Helm charts." });

    const queryTokens = tokenize("React hooks");
    const scoreHigh = scoreEntry(high, queryTokens, "search", REF_MS);
    const scoreLow = scoreEntry(low, queryTokens, "search", REF_MS);

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it("boosts coding rules in context strategy", () => {
    const rule = entry({ type: "coding_rule", content: "Use strict mode." });
    const summary = entry({ id: "mem_2", type: "session_summary", content: "Use strict mode." });

    const queryTokens = tokenize("strict mode");
    const ruleScore = scoreEntry(rule, queryTokens, "context", REF_MS);
    const summaryScore = scoreEntry(summary, queryTokens, "context", REF_MS);

    expect(ruleScore).toBeGreaterThan(summaryScore);
  });

  it("treats types nearly equally in search strategy", () => {
    const rule = entry({ type: "coding_rule", content: "Use strict mode." });
    const summary = entry({ id: "mem_2", type: "session_summary", content: "Use strict mode." });

    const queryTokens = tokenize("strict mode");
    const ruleScore = scoreEntry(rule, queryTokens, "search", REF_MS);
    const summaryScore = scoreEntry(summary, queryTokens, "search", REF_MS);

    // Scores should be very close since search strategy has flat type bias
    expect(Math.abs(ruleScore - summaryScore)).toBeLessThan(0.05);
  });

  it("favors high confidence over low confidence", () => {
    const highConf = entry({ confidence: "high", content: "Use ESLint." });
    const lowConf = entry({ id: "mem_2", confidence: "low", content: "Use ESLint." });

    const queryTokens = tokenize("ESLint");
    const scoreHigh = scoreEntry(highConf, queryTokens, "context", REF_MS);
    const scoreLow = scoreEntry(lowConf, queryTokens, "context", REF_MS);

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it("favors recent entries over old entries", () => {
    const recent = entry({ updatedAt: "2026-05-01T00:00:00.000Z", content: "Use hooks." });
    const old = entry({ id: "mem_2", updatedAt: "2025-01-01T00:00:00.000Z", content: "Use hooks." });

    const queryTokens = tokenize("hooks");
    const scoreRecent = scoreEntry(recent, queryTokens, "context", REF_MS);
    const scoreOld = scoreEntry(old, queryTokens, "context", REF_MS);

    expect(scoreRecent).toBeGreaterThan(scoreOld);
  });

  it("boosts entries with matching tags", () => {
    const tagged = entry({ tags: ["react", "frontend"], content: "Component pattern." });
    const untagged = entry({ id: "mem_2", tags: [], content: "Component pattern." });

    const queryTokens = tokenize("react");
    const scoreTagged = scoreEntry(tagged, queryTokens, "search", REF_MS);
    const scoreUntagged = scoreEntry(untagged, queryTokens, "search", REF_MS);

    expect(scoreTagged).toBeGreaterThan(scoreUntagged);
  });

  it("gives equal queryOverlap when query is empty", () => {
    const a = entry({ content: "React hooks." });
    const b = entry({ id: "mem_2", content: "Kubernetes charts." });

    const scoreA = scoreEntry(a, [], "search", REF_MS);
    const scoreB = scoreEntry(b, [], "search", REF_MS);

    // With empty query, queryOverlap is 1 for both, so scores differ only by other signals
    // These entries have same type/confidence/recency/tags, so scores should be equal
    expect(Math.abs(scoreA - scoreB)).toBeLessThan(1e-9);
  });

  it("boosts entries whose scope matches the query scope", () => {
    const backendEntry = entry({ scope: "backend", content: "Use connection pooling." });
    const frontendEntry = entry({ id: "mem_2", scope: "frontend", content: "Use connection pooling." });

    const queryTokens = tokenize("connection pooling");
    const scoreBackend = scoreEntry(backendEntry, queryTokens, "context", REF_MS, "backend");
    const scoreFrontend = scoreEntry(frontendEntry, queryTokens, "context", REF_MS, "backend");

    expect(scoreBackend).toBeGreaterThan(scoreFrontend);
  });

  it("gives partial score to global scope when a specific scope is queried", () => {
    const globalEntry = entry({ scope: "global", content: "Use strict mode." });
    const backendEntry = entry({ id: "mem_2", scope: "backend", content: "Use strict mode." });
    const frontendEntry = entry({ id: "mem_3", scope: "frontend", content: "Use strict mode." });

    const queryTokens = tokenize("strict mode");
    const scoreGlobal = scoreEntry(globalEntry, queryTokens, "context", REF_MS, "backend");
    const scoreBackend = scoreEntry(backendEntry, queryTokens, "context", REF_MS, "backend");
    const scoreFrontend = scoreEntry(frontendEntry, queryTokens, "context", REF_MS, "backend");

    // Backend (exact match) > Global (partial) > Frontend (mismatch)
    expect(scoreBackend).toBeGreaterThan(scoreGlobal);
    expect(scoreGlobal).toBeGreaterThan(scoreFrontend);
  });

  it("treats all scopes equally when no query scope is specified", () => {
    const backendEntry = entry({ scope: "backend", content: "Use strict mode." });
    const frontendEntry = entry({ id: "mem_2", scope: "frontend", content: "Use strict mode." });

    const queryTokens = tokenize("strict mode");
    const scoreBackend = scoreEntry(backendEntry, queryTokens, "context", REF_MS, undefined);
    const scoreFrontend = scoreEntry(frontendEntry, queryTokens, "context", REF_MS, undefined);

    expect(Math.abs(scoreBackend - scoreFrontend)).toBeLessThan(1e-9);
  });

  it("scope signal works in search strategy too", () => {
    const matching = entry({ scope: "testing", content: "Use vitest." });
    const nonMatching = entry({ id: "mem_2", scope: "deployment", content: "Use vitest." });

    const queryTokens = tokenize("vitest");
    const scoreMatch = scoreEntry(matching, queryTokens, "search", REF_MS, "testing");
    const scoreNoMatch = scoreEntry(nonMatching, queryTokens, "search", REF_MS, "testing");

    expect(scoreMatch).toBeGreaterThan(scoreNoMatch);
  });
});

describe("rankMemories", () => {
  it("returns entries sorted by descending score", () => {
    const entries = [
      entry({ id: "mem_weak", content: "Unrelated content about databases.", type: "session_summary", confidence: "low" }),
      entry({ id: "mem_strong", content: "React hooks pattern for components.", type: "coding_rule", confidence: "high" }),
      entry({ id: "mem_mid", content: "React is the UI framework.", type: "project_fact", confidence: "medium" }),
    ];

    const ranked = rankMemories(entries, "React hooks", "context", REF_TIME);

    expect(ranked.map((r) => r.entry.id)).toEqual(["mem_strong", "mem_mid", "mem_weak"]);
  });

  it("breaks ties by updatedAt descending", () => {
    const entries = [
      entry({ id: "mem_old", updatedAt: "2026-01-01T00:00:00.000Z", content: "Use strict mode." }),
      entry({ id: "mem_new", updatedAt: "2026-05-01T00:00:00.000Z", content: "Use strict mode." }),
    ];

    const ranked = rankMemories(entries, "strict mode", "search", REF_TIME);

    // Both have same content match but different recency; newer should rank first
    expect(ranked[0]!.entry.id).toBe("mem_new");
    expect(ranked[1]!.entry.id).toBe("mem_old");
  });

  it("context strategy ranks gotchas above session summaries for same content", () => {
    const entries = [
      entry({ id: "mem_summary", type: "session_summary", content: "Watch out for circular imports." }),
      entry({ id: "mem_gotcha", type: "known_gotcha", content: "Watch out for circular imports." }),
    ];

    const ranked = rankMemories(entries, "circular imports", "context", REF_TIME);

    expect(ranked[0]!.entry.id).toBe("mem_gotcha");
  });

  it("search strategy ranks by text relevance over type", () => {
    const entries = [
      entry({ id: "mem_rule", type: "coding_rule", content: "Use ESLint for linting." }),
      entry({ id: "mem_fact", type: "project_fact", content: "React hooks manage component state and side effects." }),
    ];

    const ranked = rankMemories(entries, "React hooks state", "search", REF_TIME);

    // mem_fact has better query overlap (3/3 tokens match) than mem_rule (0/3)
    expect(ranked[0]!.entry.id).toBe("mem_fact");
  });

  it("returns all entries with scores", () => {
    const entries = [
      entry({ id: "mem_1" }),
      entry({ id: "mem_2", content: "Different content." }),
    ];

    const ranked = rankMemories(entries, "", "context", REF_TIME);

    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(0);
    expect(ranked[0]!.score).toBeLessThanOrEqual(1);
  });

  it("returns empty array for empty input", () => {
    const ranked = rankMemories([], "some query", "context", REF_TIME);
    expect(ranked).toEqual([]);
  });

  it("uses current time when referenceTime is omitted", () => {
    const entries = [entry({ id: "mem_1" })];
    const ranked = rankMemories(entries, "", "context");

    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.score).toBeGreaterThan(0);
  });

  it("forbidden_pattern ranks high in context strategy", () => {
    const entries = [
      entry({ id: "mem_fact", type: "project_fact", content: "Never use eval in this project." }),
      entry({ id: "mem_forbidden", type: "forbidden_pattern", content: "Never use eval in this project." }),
    ];

    const ranked = rankMemories(entries, "eval", "context", REF_TIME);

    expect(ranked[0]!.entry.id).toBe("mem_forbidden");
  });

  it("ranks entries matching query scope higher", () => {
    const entries = [
      entry({ id: "mem_backend", scope: "backend", content: "Use connection pooling for database queries." }),
      entry({ id: "mem_frontend", scope: "frontend", content: "Use connection pooling for API calls." }),
      entry({ id: "mem_global", scope: "global", content: "Use connection pooling everywhere." }),
    ];

    const ranked = rankMemories(entries, "connection pooling", "context", REF_TIME, "backend");

    expect(ranked[0]!.entry.id).toBe("mem_backend");
    // Global should rank above frontend (partial vs zero scope match)
    const globalIdx = ranked.findIndex((r) => r.entry.id === "mem_global");
    const frontendIdx = ranked.findIndex((r) => r.entry.id === "mem_frontend");
    expect(globalIdx).toBeLessThan(frontendIdx);
  });

  it("does not penalize any scope when queryScope is omitted", () => {
    const entries = [
      entry({ id: "mem_backend", scope: "backend", content: "Same content." }),
      entry({ id: "mem_frontend", scope: "frontend", content: "Same content." }),
    ];

    const ranked = rankMemories(entries, "Same content", "context", REF_TIME);

    // Scores should be equal — no scope preference
    expect(Math.abs(ranked[0]!.score - ranked[1]!.score)).toBeLessThan(1e-9);
  });
});
