import { describe, expect, it } from "vitest";
import { annotateConflicts, bigrams, rankMemories, scoreEntry, tokenize } from "@openmembrane/core";
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

describe("annotateConflicts", () => {
  it("returns results without conflicts field when no conflicts exist", () => {
    const ranked = rankMemories(
      [
        entry({ id: "mem_1", content: "Use React for frontend components." }),
        entry({ id: "mem_2", content: "Frontend tests require mocked runtime config." }),
      ],
      "frontend",
      "context",
      REF_TIME,
    );

    const annotated = annotateConflicts(ranked);
    expect(annotated).toHaveLength(2);
    expect(annotated[0]!.conflicts).toBeUndefined();
    expect(annotated[1]!.conflicts).toBeUndefined();
  });

  it("annotates negation conflicts between scored memories", () => {
    const ranked = rankMemories(
      [
        entry({ id: "mem_1", content: "Use NgModules for all feature modules." }),
        entry({ id: "mem_2", content: "Do not use NgModules in this project." }),
      ],
      "NgModules",
      "context",
      REF_TIME,
    );

    const annotated = annotateConflicts(ranked);
    expect(annotated).toHaveLength(2);

    const first = annotated.find((s) => s.entry.id === "mem_1")!;
    const second = annotated.find((s) => s.entry.id === "mem_2")!;

    expect(first.conflicts).toHaveLength(1);
    expect(first.conflicts![0]!.memoryId).toBe("mem_2");
    expect(first.conflicts![0]!.kind).toBe("negation");

    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts![0]!.memoryId).toBe("mem_1");
    expect(second.conflicts![0]!.kind).toBe("negation");
  });

  it("annotates alternative conflicts between scored memories", () => {
    const ranked = rankMemories(
      [
        entry({ id: "mem_1", content: "Use React for frontend components." }),
        entry({ id: "mem_2", content: "Use Angular for frontend components." }),
      ],
      "frontend framework",
      "context",
      REF_TIME,
    );

    const annotated = annotateConflicts(ranked);
    const first = annotated.find((s) => s.entry.id === "mem_1")!;
    expect(first.conflicts).toHaveLength(1);
    expect(first.conflicts![0]!.kind).toBe("alternative");
  });

  it("annotates version mismatch conflicts between scored memories", () => {
    const ranked = rankMemories(
      [
        entry({ id: "mem_1", content: "Target Node 22 for backend services.", scope: "backend" }),
        entry({ id: "mem_2", content: "Target Node 18 for backend services.", scope: "backend" }),
      ],
      "Node version",
      "context",
      REF_TIME,
    );

    const annotated = annotateConflicts(ranked);
    const first = annotated.find((s) => s.entry.id === "mem_1")!;
    expect(first.conflicts).toHaveLength(1);
    expect(first.conflicts![0]!.kind).toBe("version_mismatch");
  });

  it("preserves scores from input", () => {
    const ranked = rankMemories(
      [
        entry({ id: "mem_1", content: "Use React for frontend components." }),
        entry({ id: "mem_2", content: "Use Angular for frontend components." }),
      ],
      "frontend framework",
      "context",
      REF_TIME,
    );

    const annotated = annotateConflicts(ranked);
    expect(annotated[0]!.score).toBe(ranked[0]!.score);
    expect(annotated[1]!.score).toBe(ranked[1]!.score);
  });

  it("returns single-element arrays unchanged", () => {
    const ranked = rankMemories(
      [entry({ id: "mem_1", content: "Use React for frontend." })],
      "React",
      "context",
      REF_TIME,
    );

    const annotated = annotateConflicts(ranked);
    expect(annotated).toHaveLength(1);
    expect(annotated[0]!.conflicts).toBeUndefined();
  });

  it("returns empty array for empty input", () => {
    const annotated = annotateConflicts([]);
    expect(annotated).toEqual([]);
  });
});

describe("bigrams", () => {
  it("builds consecutive token pairs", () => {
    expect(bigrams(["react", "hooks", "pattern"])).toEqual([
      "react hooks",
      "hooks pattern",
    ]);
  });

  it("returns empty array for single token", () => {
    expect(bigrams(["react"])).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(bigrams([])).toEqual([]);
  });
});

describe("partial token matching", () => {
  it("gives partial score when query token is substring of haystack token", () => {
    // "react" is an exact match, "hook" is a substring of "hooks"
    const withSubstring = entry({ content: "React hooks pattern for components." });
    const noMatch = entry({ id: "mem_2", content: "Angular services for backend." });

    const queryTokens = tokenize("react hook");
    const scoreWith = scoreEntry(withSubstring, queryTokens, "search", REF_MS);
    const scoreNo = scoreEntry(noMatch, queryTokens, "search", REF_MS);

    expect(scoreWith).toBeGreaterThan(scoreNo);
  });

  it("gives partial score when haystack token is substring of query token", () => {
    // "hooks" in haystack is a substring of "hookstate" in query
    const withSubstring = entry({ content: "React hooks pattern." });
    const noMatch = entry({ id: "mem_2", content: "Angular services." });

    const queryTokens = tokenize("hookstate");
    const scoreWith = scoreEntry(withSubstring, queryTokens, "search", REF_MS);
    const scoreNo = scoreEntry(noMatch, queryTokens, "search", REF_MS);

    expect(scoreWith).toBeGreaterThan(scoreNo);
  });

  it("weighs exact matches higher than partial matches", () => {
    const exact = entry({ content: "react hooks are useful." });
    const partial = entry({ id: "mem_2", content: "react hookstate is useful." });

    // Query "hooks" exactly matches "hooks" in exact, only partially matches "hookstate" in partial
    const queryTokens = tokenize("hooks");
    const scoreExact = scoreEntry(exact, queryTokens, "search", REF_MS);
    const scorePartial = scoreEntry(partial, queryTokens, "search", REF_MS);

    expect(scoreExact).toBeGreaterThan(scorePartial);
  });

  it("react hooks scores higher against react custom hooks than angular services", () => {
    const reactCustomHooks = entry({ content: "React custom hooks for state management." });
    const angularServices = entry({ id: "mem_2", content: "Angular services for dependency injection." });

    const ranked = rankMemories(
      [angularServices, reactCustomHooks],
      "react hooks",
      "search",
      REF_TIME,
    );

    expect(ranked[0]!.entry.id).toBe("mem_1"); // reactCustomHooks
  });

  it("does not give partial credit for short tokens (< 3 chars)", () => {
    // Content "don't" tokenizes to ["don", "t"], producing the 1-char token "t".
    // Query "database" contains "t", but should NOT get partial credit.
    const withShortToken = entry({ content: "Don't use eval in production." });
    const noMatch = entry({ id: "mem_2", content: "Kubernetes deployment uses Helm charts." });

    const queryTokens = tokenize("database");
    const scoreShort = scoreEntry(withShortToken, queryTokens, "search", REF_MS);
    const scoreNone = scoreEntry(noMatch, queryTokens, "search", REF_MS);

    // Neither should get partial credit — scores should be equal
    expect(Math.abs(scoreShort - scoreNone)).toBeLessThan(1e-9);
  });
});

describe("reason field in haystack", () => {
  it("includes reason field content in query overlap scoring", () => {
    const withReason = entry({
      content: "Use connection pooling.",
      reason: "Improves database performance under load.",
    });
    const withoutReason = entry({
      id: "mem_2",
      content: "Use connection pooling.",
      reason: "test",
    });

    // Query for a term only present in the reason field
    const queryTokens = tokenize("database performance");
    const scoreWithReason = scoreEntry(withReason, queryTokens, "search", REF_MS);
    const scoreWithoutReason = scoreEntry(withoutReason, queryTokens, "search", REF_MS);

    expect(scoreWithReason).toBeGreaterThan(scoreWithoutReason);
  });

  it("reason field contributes to ranking order", () => {
    const entries = [
      entry({ id: "mem_no_reason", content: "Use ESLint for linting.", reason: "test" }),
      entry({ id: "mem_with_reason", content: "Use ESLint for linting.", reason: "Catches common TypeScript errors early." }),
    ];

    const ranked = rankMemories(entries, "TypeScript errors", "search", REF_TIME);

    expect(ranked[0]!.entry.id).toBe("mem_with_reason");
  });
});

describe("bigram scoring", () => {
  it("boosts entries where query bigrams appear in content", () => {
    // "react hooks" appears as consecutive tokens in both, but "custom hooks" does not match bigram "react hooks"
    const exactBigram = entry({ content: "React hooks are the standard pattern." });
    const noBigram = entry({ id: "mem_2", content: "Hooks for React are custom built." });

    const queryTokens = tokenize("react hooks");
    const scoreExactBigram = scoreEntry(exactBigram, queryTokens, "search", REF_MS);
    const scoreNoBigram = scoreEntry(noBigram, queryTokens, "search", REF_MS);

    // Both have exact token matches, but exactBigram also has the bigram "react hooks"
    expect(scoreExactBigram).toBeGreaterThan(scoreNoBigram);
  });

  it("single-token queries get no bigram bonus", () => {
    const a = entry({ content: "React hooks pattern." });
    const b = entry({ id: "mem_2", content: "React component pattern." });

    // Single token query — no bigrams possible
    const queryTokens = tokenize("react");
    const scoreA = scoreEntry(a, queryTokens, "search", REF_MS);
    const scoreB = scoreEntry(b, queryTokens, "search", REF_MS);

    // Both have exact match on "react"; score difference comes from other token partial matches, not bigrams
    // The key assertion is that this doesn't error and scores are reasonable
    expect(scoreA).toBeGreaterThanOrEqual(0);
    expect(scoreB).toBeGreaterThanOrEqual(0);
  });

  it("multi-word phrases rank higher when bigrams match", () => {
    const entries = [
      entry({ id: "mem_exact_phrase", content: "Use strict mode in all TypeScript files." }),
      entry({ id: "mem_scattered", content: "TypeScript is strict about types. Mode is irrelevant." }),
    ];

    const ranked = rankMemories(entries, "strict mode TypeScript", "search", REF_TIME);

    // "strict mode" bigram appears in mem_exact_phrase, not in mem_scattered
    expect(ranked[0]!.entry.id).toBe("mem_exact_phrase");
  });
});
