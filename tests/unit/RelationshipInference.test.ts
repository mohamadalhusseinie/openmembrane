import { describe, expect, it } from "vitest";
import { inferRelationships, relationshipKey } from "@openmembrane/core";
import { candidate, entry } from "./helpers";

describe("inferRelationships", () => {
  it("links shared tags and source sessions with evidence and confidence", () => {
    const drafts = inferRelationships({
      memories: [
        entry({ id: "mem_1", content: "Use pnpm workspaces.", tags: ["Build", "tooling"], source: { kind: "session", sessionId: "s-1" } }),
        entry({ id: "mem_2", content: "Release with changesets.", tags: ["build", "tooling"], source: { kind: "session", sessionId: "s-1" } }),
      ],
      candidates: [],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      source: { kind: "memory", id: "mem_1" },
      target: { kind: "memory", id: "mem_2" },
      type: "related_to",
    });
    expect(drafts[0]!.confidence).toBeGreaterThan(0.75);
    expect(drafts[0]!.confidence).toBeLessThanOrEqual(1);
    expect(drafts[0]!.rationale).toContain("shared tags: build, tooling");
    expect(drafts[0]!.rationale).toContain("same source session: s-1");
    expect(drafts[0]!.rationale).toContain("same scope and type: frontend coding_rule");
  });

  it("uses compatible scope and type only to strengthen another signal", () => {
    const compatibleOnly = inferRelationships({
      memories: [entry({ id: "mem_1", content: "Alpha beta gamma." }), entry({ id: "mem_2", content: "Delta epsilon zeta." })],
      candidates: [],
    });
    expect(compatibleOnly).toEqual([]);

    const tagged = (scope: "frontend" | "backend") => inferRelationships({
      memories: [
        entry({ id: "mem_1", content: "Alpha beta gamma.", tags: ["ui"] }),
        entry({ id: "mem_2", content: "Delta epsilon zeta.", tags: ["ui"], scope }),
      ],
      candidates: [],
    });
    expect(tagged("frontend")[0]!.confidence).toBeGreaterThan(0.4);
    expect(tagged("backend")).toEqual([]);
  });

  it("omits low-confidence text-only matches by default", () => {
    const input = {
      memories: [
        entry({ id: "mem_1", content: "Run vitest before pushing branch changes." }),
        entry({ id: "mem_2", content: "Run vitest before opening pull requests." }),
      ],
      candidates: [],
    };
    expect(inferRelationships(input)).toEqual([]);
    const loose = inferRelationships(input, { includeLowConfidenceTextMatches: true });
    expect(loose).toHaveLength(1);
    expect(loose[0]!.rationale).toContain("text similarity");

    const strong = inferRelationships({
      memories: [
        entry({ id: "mem_1", content: "Always run vitest before pushing branch changes." }),
        entry({ id: "mem_2", content: "Always run vitest before pushing branch updates." }),
      ],
      candidates: [],
    });
    expect(strong).toHaveLength(1);
    expect(strong[0]!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("infers duplicate, conflict, and supersession links from metadata without redundant related links", () => {
    const drafts = inferRelationships({
      memories: [
        entry({ id: "mem_old", status: "superseded", supersededBy: "mem_new", tags: ["db"] }),
        entry({ id: "mem_new", tags: ["db"] }),
        entry({ id: "mem_approved", content: "Unrelated approved memory." }),
      ],
      candidates: [candidate({ id: "cand_1", duplicateOf: "mem_new", conflictWith: ["mem_old", "mem_missing"], tags: ["db"] })],
      supersessions: [{ supersededId: "mem_old", supersededBy: "cand_approved" }],
    });
    const summary = drafts.map((draft) => [draft.source.id, draft.type, draft.target.id, draft.confidence]);
    expect(summary).toEqual(expect.arrayContaining([
      ["cand_1", "duplicate_of", "mem_new", 1],
      ["cand_1", "conflicts_with", "mem_old", 1],
      ["mem_new", "supersedes", "mem_old", 1],
      ["mem_approved", "supersedes", "mem_old", 1],
    ]));
    expect(drafts.filter((draft) => draft.type === "related_to")).toEqual([]);
    expect(drafts.some((draft) => draft.target.id === "mem_missing")).toBe(false);
  });

  it("deduplicates edges and excludes secret content", () => {
    const drafts = inferRelationships({
      memories: [
        entry({ id: "mem_1", tags: ["api"] }),
        entry({ id: "mem_1", tags: ["api"] }),
        entry({ id: "mem_2", tags: ["api"] }),
        entry({ id: "mem_secret", content: "token = abcdefgh12345678", tags: ["api"] }),
      ],
      candidates: [
        candidate({ id: "cand_secret", sensitivity: "secret", tags: ["api"] }),
        candidate({ id: "cand_tag", tags: ["api", "ghp_abcdefghijklmnopqrstuvwxyz"] }),
      ],
    });
    const keys = drafts.map(relationshipKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(drafts.map((draft) => `${draft.source.id}-${draft.target.id}`)).toEqual(["cand_tag-mem_1", "cand_tag-mem_2", "mem_1-mem_2"]);
    expect(JSON.stringify(drafts)).not.toMatch(/secret|ghp_/);
  });

  it("produces identical output for identical input regardless of order", () => {
    const memories = Array.from({ length: 30 }, (_, index) =>
      entry({ id: `mem_${index}`, content: `Rule ${index % 5} for module ${index % 3}.`, tags: [`t${index % 4}`], source: { kind: "session", sessionId: `s${index % 6}` } }),
    );
    const candidates = Array.from({ length: 10 }, (_, index) => candidate({ id: `cand_${index}`, tags: [`t${index % 4}`] }));
    const first = inferRelationships({ memories, candidates });
    const second = inferRelationships({ memories: [...memories].reverse(), candidates: [...candidates].reverse() });
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it("stays bounded for 500 entities", () => {
    const memories = Array.from({ length: 400 }, (_, index) =>
      entry({ id: `mem_${String(index).padStart(3, "0")}`, content: `Shared guidance about build tooling item ${index}.`, tags: ["shared", `g${index % 10}`], source: { kind: "session", sessionId: "same" } }),
    );
    const candidates = Array.from({ length: 200 }, (_, index) => candidate({ id: `cand_${String(index).padStart(3, "0")}`, tags: ["shared"] }));
    const started = performance.now();
    const drafts = inferRelationships({ memories, candidates });
    expect(performance.now() - started).toBeLessThan(5000);

    const endpoints = new Set(drafts.flatMap((draft) => [`${draft.source.kind}:${draft.source.id}`, `${draft.target.kind}:${draft.target.id}`]));
    expect(endpoints.size).toBeLessThanOrEqual(500);
    expect([...endpoints].some((key) => key.startsWith("candidate:cand_1"))).toBe(false);
    const degree = new Map<string, number>();
    for (const draft of drafts) {
      for (const ref of [draft.source, draft.target]) degree.set(ref.id, (degree.get(ref.id) ?? 0) + 1);
    }
    expect(Math.max(...degree.values())).toBeLessThanOrEqual(8);
    expect(drafts.length).toBeLessThanOrEqual((500 * 8) / 2);
  });
});
