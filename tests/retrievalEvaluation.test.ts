import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MemoryEntry, MemorySearchOptions, MemoryScope } from "@openmembrane/core";
import { createStores, type StorageBackend } from "@openmembrane/storage";
import { createProjectState } from "../packages/service/src/factory";
import { createProjectOperations } from "../packages/service/src/operations";
import { candidate, entry } from "./unit/helpers";

const FIXTURE_VERSION = 1;
const PROJECT = "project-a";
const OLD = "2025-01-01T00:00:00.000Z";
const RECENT = "2026-05-08T00:00:00.000Z";
const LIMIT = 10;

type Case = {
  name: string;
  query: string;
  expected: readonly string[];
  scopes?: MemoryScope[];
  types?: MemorySearchOptions["types"];
  tags?: string[];
};

// Ground truth and minimum per-case recall were fixed before the retrieval change (#144).
const cases: readonly Case[] = [
  { name: "exact", query: "vitest unit tests", expected: ["rule_vitest"] },
  { name: "old-workspace", query: "pnpm workspace protocol", expected: ["rule_workspace_protocol"] },
  { name: "synonym", query: "credentials commits", expected: ["rule_no_secrets"] },
  { name: "scope", query: "trace correlation", scopes: ["backend"], expected: ["rule_backend_trace"] },
  { name: "type", query: "trace correlation", types: ["security_rule"], expected: ["rule_backend_trace"] },
  { name: "tag", query: "trace correlation", tags: ["observability"], expected: ["rule_backend_trace"] },
  { name: "conflict", query: "dependency installs", expected: ["rule_npm", "rule_pnpm"] },
  { name: "superseded-negative", query: "mocha runner", expected: [] },
  { name: "project-negative", query: "project-b-exclusive", expected: [] },
];

function corpus(): MemoryEntry[] {
  const notes = Array.from({ length: 36 }, (_, index) =>
    entry({
      id: `workspace_note_${String(index + 1).padStart(2, "0")}`,
      content: `Workspace migration note ${index + 1}: align catalog metadata for release planning.`,
      scope: "backend",
      type: "project_fact",
      updatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      approvedAt: RECENT,
    }),
  );
  return [
    entry({
      id: "rule_workspace_protocol", content: "Use pnpm workspace protocol for internal packages.",
      scope: "backend", updatedAt: OLD, approvedAt: OLD,
    }),
    ...notes,
    entry({ id: "rule_vitest", content: "Use vitest for unit tests.", approvedAt: RECENT }),
    entry({
      id: "rule_no_secrets", content: "Never check secrets into git.",
      scope: "global", type: "security_rule", tags: ["privacy"], approvedAt: RECENT,
    }),
    entry({
      id: "rule_backend_trace", content: "Retain trace correlation ids in server logs.",
      scope: "backend", type: "security_rule", tags: ["observability"], approvedAt: RECENT,
    }),
    entry({
      id: "fact_frontend_trace", content: "Display trace correlation ids in client errors.",
      scope: "frontend", type: "project_fact", tags: ["ui"], approvedAt: RECENT,
    }),
    entry({
      id: "fact_backend_trace", content: "Include trace correlation ids in server diagnostics.",
      scope: "backend", type: "project_fact", tags: ["telemetry"], approvedAt: RECENT,
    }),
    entry({ id: "rule_npm", content: "Use npm for dependency installs.", approvedAt: RECENT }),
    entry({ id: "rule_pnpm", content: "Use pnpm for dependency installs.", approvedAt: RECENT }),
    entry({
      id: "rule_mocha_retired", content: "Use mocha runner for unit tests.", status: "superseded",
      supersededBy: "rule_vitest", supersededAt: RECENT, approvedAt: OLD,
    }),
    entry({
      id: "rule_other_project", projectId: "project-b",
      content: "Use project-b-exclusive vitest unit tests.", approvedAt: RECENT,
    }),
  ];
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)]!;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

describe("retrieval evaluation v1", () => {
  for (const backend of ["json", "sqlite"] as const satisfies readonly StorageBackend[]) {
    it(`records ${backend} context/search metrics and eligibility`, async () => {
      // Keep scratch data inside the worktree; the test owns and removes it.
      const dir = await mkdtemp(join(process.cwd(), ".retrieval-evaluation-"));
      let stores: Awaited<ReturnType<typeof createStores>> | undefined;
      try {
        stores = await createStores({ backend, baseDir: dir });
        const state = await createProjectState(
          { projectRoot: dir, storageDir: dir, projectId: PROJECT },
          { deferExtractionInitialization: true },
          stores,
        );
        const operations = createProjectOperations(state);
        for (const memory of corpus()) await stores.memoryStore.save(memory);
        await stores.pendingCandidateStore.save(candidate({
          id: "candidate_pending", content: "Use vitest for unit tests.", recommendedAction: "ask_user",
        }));
        await stores.pendingCandidateStore.save(candidate({
          id: "candidate_extra", content: "Use vitest for unit tests.", recommendedAction: "ask_user",
        }));
        await stores.pendingCandidateStore.save(candidate({
          id: "candidate_rejected", content: "Use vitest for unit tests.",
          recommendedAction: "reject", rejectionReason: "not durable",
        }));
        await stores.pendingCandidateStore.remove(PROJECT, "candidate_rejected");

        expect((await stores.memoryStore.search(PROJECT, "workspace", { limit: 100 })).length)
          .toBeGreaterThan(30);
        for (const operation of ["context", "search"] as const) {
          const selected = cases.filter((testCase) =>
            operation === "search" || (testCase.types === undefined && testCase.tags === undefined),
          );
          const measurements: Array<{
            case: string; expected: readonly string[]; returned: string[];
            recallAt10: number | null; precisionAt10: number; medianMs: number;
          }> = [];
          for (const testCase of selected) {
            const times: number[] = [];
            let results: MemoryEntry[] = [];
            for (let iteration = 0; iteration < 5; iteration++) {
              const start = performance.now();
              if (operation === "context") {
                const result = await operations.getRelevantContext({
                  query: testCase.query, limit: LIMIT, ...(testCase.scopes ? { scope: testCase.scopes[0] } : {}),
                });
                expect(result.pendingCandidateCount).toBe(2);
                results = result.memories;
              } else {
                results = await operations.searchMemory({
                  query: testCase.query, limit: LIMIT,
                  ...(testCase.scopes ? { scopes: testCase.scopes } : {}),
                  ...(testCase.types ? { types: testCase.types } : {}),
                  ...(testCase.tags ? { tags: testCase.tags } : {}),
                });
              }
              times.push(performance.now() - start);
            }
            const ids = results.map((result) => result.id);
            const relevant = ids.filter((id) => testCase.expected.includes(id)).length;
            measurements.push({
              case: testCase.name, expected: testCase.expected, returned: ids,
              recallAt10: testCase.expected.length ? round(relevant / testCase.expected.length) : null,
              precisionAt10: round(relevant / LIMIT),
              medianMs: round(median(times)),
            });

            expect(ids).not.toContain("rule_mocha_retired");
            expect(ids).not.toContain("rule_other_project");
            expect(ids).not.toContain("candidate_pending");
            expect(ids).not.toContain("candidate_extra");
            expect(ids).not.toContain("candidate_rejected");
            if (testCase.expected.length === 0) expect(ids).toEqual([]);
            if (["exact", "old-workspace", "scope", "type", "tag", "conflict"].includes(testCase.name)) {
              expect(relevant).toBe(testCase.expected.length);
            }
            if (testCase.name === "synonym") expect(relevant).toBe(0);
            if (testCase.name === "conflict" && operation === "context") {
              for (const result of results) {
                const otherId = result.id === "rule_npm" ? "rule_pnpm" : "rule_npm";
                expect(result).toMatchObject({
                  conflicts: expect.arrayContaining([{ memoryId: otherId, kind: "alternative" }]),
                });
              }
            }
            if (operation === "search") {
              expect(results.every((result) => !("conflicts" in result))).toBe(true);
            }
          }
          const positives = measurements.filter((m) => m.recallAt10 !== null);
          console.info("RETRIEVAL_EVAL_V1 " + JSON.stringify({
            version: FIXTURE_VERSION, backend, operation, limit: LIMIT, repetitions: 5,
            macroRecallAt10: round(positives.reduce((sum, m) => sum + m.recallAt10!, 0) / positives.length),
            macroPrecisionAt10: round(positives.reduce((sum, m) => sum + m.precisionAt10, 0) / positives.length),
            medianQueryMs: round(median(measurements.map((m) => m.medianMs))),
            cases: measurements,
          }));
        }
      } finally {
        stores?.close?.();
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
});
