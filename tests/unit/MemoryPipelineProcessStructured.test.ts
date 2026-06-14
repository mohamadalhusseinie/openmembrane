import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryPipeline, MockMemoryExtractor } from "@openmembrane/core";
import { JsonAuditLogStore, JsonMemoryStore, JsonPendingCandidateStore } from "@openmembrane/storage";
import { candidate } from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createPipeline() {
  const baseDir = await mkdtemp(join(tmpdir(), "openmembrane-test-"));
  tempDirs.push(baseDir);

  const memoryStore = new JsonMemoryStore(baseDir);
  const pendingCandidateStore = new JsonPendingCandidateStore(baseDir);
  const auditLogStore = new JsonAuditLogStore(baseDir);
  const pipeline = new MemoryPipeline({
    extractor: new MockMemoryExtractor(),
    memoryStore,
    pendingCandidateStore,
    auditLogStore
  });

  return { pipeline, memoryStore, pendingCandidateStore, auditLogStore };
}

describe("MemoryPipeline.processStructured", () => {
  it("saves a valid single candidate", async () => {
    const { pipeline } = await createPipeline();

    const result = await pipeline.processStructured("project-a", [
      candidate({ id: "cand_s1", content: "Always use strict mode in TypeScript." })
    ]);

    expect(result.saved).toHaveLength(1);
    expect(result.pending).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it("saves multiple candidates in batch", async () => {
    const { pipeline } = await createPipeline();

    const result = await pipeline.processStructured("project-a", [
      candidate({ id: "cand_b1", content: "Use ESM modules exclusively." }),
      candidate({ id: "cand_b2", content: "Prefer explicit return types on exported functions." }),
      candidate({ id: "cand_b3", content: "No enums, use as const arrays." })
    ]);

    expect(result.saved).toHaveLength(3);
  });

  it("rejects duplicate candidates", async () => {
    const { pipeline } = await createPipeline();

    const first = await pipeline.processStructured("project-a", [
      candidate({ id: "cand_d1", content: "Use vitest for all unit tests." })
    ]);
    expect(first.saved).toHaveLength(1);

    const second = await pipeline.processStructured("project-a", [
      candidate({ id: "cand_d2", content: "Use vitest for all unit tests." })
    ]);

    expect(second.rejected).toHaveLength(1);
    expect(second.rejected[0]?.duplicateOf).toBeDefined();
    expect(second.saved).toHaveLength(0);
  });

  it("detects conflicts and auto-supersedes", async () => {
    const { pipeline, memoryStore } = await createPipeline();

    const first = await pipeline.processStructured("project-a", [
      candidate({ id: "cand_c1", content: "Use React for the frontend UI framework.", scope: "frontend" })
    ]);
    expect(first.saved).toHaveLength(1);

    const second = await pipeline.processStructured("project-a", [
      candidate({ id: "cand_c2", content: "Use Angular for the frontend UI framework.", scope: "frontend" })
    ]);

    expect(second.saved).toHaveLength(1);
    const memories = await memoryStore.list("project-a");
    const active = memories.filter((m) => m.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]?.content).toContain("Angular");
  });

  it("queues ask_user candidates for architecture decisions", async () => {
    const { pipeline } = await createPipeline();

    const result = await pipeline.processStructured("project-a", [
      candidate({
        id: "cand_a1",
        type: "architecture_decision",
        content: "The API layer uses a thin controller pattern with no business logic.",
        confidence: "high"
      })
    ]);

    expect(result.pending).toHaveLength(1);
    expect(result.saved).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it("returns empty redactions", async () => {
    const { pipeline } = await createPipeline();

    const result = await pipeline.processStructured("project-a", [
      candidate({ id: "cand_r1", content: "Keep files focused." })
    ]);

    expect(result.redactions).toEqual([]);
  });

  it("rejects candidates with redacted secret markers", async () => {
    const { pipeline } = await createPipeline();

    const result = await pipeline.processStructured("project-a", [
      candidate({
        id: "cand_sec1",
        content: "The API key is [REDACTED:openai_api_key] and should be rotated."
      })
    ]);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.sensitivity).toBe("secret");
    expect(result.saved).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
  });
});
