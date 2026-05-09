import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryPipeline, MockMemoryExtractor } from "@openmembrain/core";
import { JsonAuditLogStore, JsonMemoryStore, JsonPendingCandidateStore } from "@openmembrain/storage";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createPipeline() {
  const baseDir = await mkdtemp(join(tmpdir(), "openmembrain-test-"));
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

  return {
    pipeline,
    memoryStore,
    pendingCandidateStore,
    auditLogStore
  };
}

describe("MemoryPipeline", () => {
  it("rejects secrets and does not persist them", async () => {
    const { pipeline, memoryStore } = await createPipeline();

    const result = await pipeline.process({
      projectId: "project-a",
      transcript: "remember: The API key is sk-proj-abcdefghijklmnopqrstuvwxyz1234567890"
    });

    expect(result.redactions).toHaveLength(1);
    expect(result.saved).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.sensitivity).toBe("secret");
    expect(result.rejected[0]?.content).not.toContain("sk-proj-");
    await expect(memoryStore.list("project-a")).resolves.toHaveLength(0);
  });

  it("rejects temporary debugging logs and stack traces", async () => {
    const { pipeline, memoryStore } = await createPipeline();

    const result = await pipeline.process({
      projectId: "project-a",
      transcript: "remember: Temporary stack trace: Error: boom at Service.handle (src/service.ts:10:5)"
    });

    expect(result.saved).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.rejectionReason).toContain("Temporary stack traces");
    await expect(memoryStore.list("project-a")).resolves.toHaveLength(0);
  });

  it("auto-saves high-confidence low-risk coding rules", async () => {
    const { pipeline, memoryStore } = await createPipeline();

    const result = await pipeline.process({
      projectId: "project-a",
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules."
    });

    expect(result.saved).toHaveLength(1);
    expect(result.pending).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.saved[0]?.type).toBe("coding_rule");
    await expect(memoryStore.list("project-a")).resolves.toHaveLength(1);
  });

  it("queues architecture decisions for approval", async () => {
    const { pipeline, pendingCandidateStore } = await createPipeline();

    const result = await pipeline.process({
      projectId: "project-a",
      transcript: "architecture: Runtime environment config is preferred over compile-time environment replacement."
    });

    expect(result.saved).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.pending[0]?.recommendedAction).toBe("ask_user");
    await expect(pendingCandidateStore.list("project-a")).resolves.toHaveLength(1);
  });

  it("does not save duplicate memory twice", async () => {
    const { pipeline, memoryStore } = await createPipeline();
    const input = {
      projectId: "project-a",
      transcript: "rule: Frontend tests require runtime config to be mocked."
    };

    const first = await pipeline.process(input);
    const second = await pipeline.process(input);

    expect(first.saved).toHaveLength(1);
    expect(second.saved).toHaveLength(0);
    expect(second.rejected).toHaveLength(1);
    expect(second.rejected[0]?.duplicateOf).toBe(first.saved[0]?.id);
    await expect(memoryStore.list("project-a")).resolves.toHaveLength(1);
  });

  it("does not queue duplicate pending candidate when same content is already pending", async () => {
    const { pipeline, pendingCandidateStore } = await createPipeline();
    const input = {
      projectId: "project-a",
      transcript: "architecture: Runtime environment config is preferred over compile-time environment replacement."
    };

    const first = await pipeline.process(input);
    const second = await pipeline.process(input);

    expect(first.pending).toHaveLength(1);
    expect(second.pending).toHaveLength(0);
    expect(second.rejected).toHaveLength(1);
    expect(second.rejected[0]?.duplicateOf).toBe(first.pending[0]?.id);
    await expect(pendingCandidateStore.list("project-a")).resolves.toHaveLength(1);
  });

  it("queues conflicting auto-save candidates and references the existing memory", async () => {
    const { pipeline, memoryStore, pendingCandidateStore } = await createPipeline();

    const first = await pipeline.process({
      projectId: "project-a",
      transcript: "rule: This project uses React for frontend components."
    });
    const second = await pipeline.process({
      projectId: "project-a",
      transcript: "rule: This project uses Angular for frontend components."
    });

    expect(first.saved).toHaveLength(1);
    expect(second.saved).toHaveLength(0);
    expect(second.pending).toHaveLength(1);
    expect(second.pending[0]?.recommendedAction).toBe("ask_user");
    expect(second.pending[0]?.conflictWith).toEqual([first.saved[0]?.id]);
    await expect(memoryStore.list("project-a")).resolves.toHaveLength(1);
    await expect(pendingCandidateStore.list("project-a")).resolves.toHaveLength(1);
  });
});
