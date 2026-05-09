import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { OpenMembrainError } from "@openmembrain/core";
import { JsonMemoryStore } from "@openmembrain/storage";
import { entry } from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createStore(): Promise<JsonMemoryStore> {
  const dir = await mkdtemp(join(tmpdir(), "openmembrain-supersede-test-"));
  tempDirs.push(dir);
  return new JsonMemoryStore(dir);
}

describe("JsonMemoryStore.supersede", () => {
  it("supersedes an active memory and returns updated entry", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1" }));
    const result = await store.supersede("project-a", "mem_1");
    expect(result.status).toBe("superseded");
    expect(result.supersededAt).toBeDefined();
  });

  it("sets supersededBy when provided", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1" }));
    const result = await store.supersede("project-a", "mem_1", "mem_2");
    expect(result.supersededBy).toBe("mem_2");
  });

  it("throws MEMORY_NOT_FOUND when memory does not exist", async () => {
    const store = await createStore();
    await expect(store.supersede("project-a", "mem_nonexistent")).rejects.toThrow(OpenMembrainError);
    try {
      await store.supersede("project-a", "mem_nonexistent");
    } catch (error) {
      expect((error as OpenMembrainError).code).toBe("MEMORY_NOT_FOUND");
    }
  });

  it("throws MEMORY_ALREADY_SUPERSEDED when memory is already superseded", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1" }));
    await store.supersede("project-a", "mem_1");
    await expect(store.supersede("project-a", "mem_1")).rejects.toThrow(OpenMembrainError);
    try {
      await store.supersede("project-a", "mem_1");
    } catch (error) {
      expect((error as OpenMembrainError).code).toBe("MEMORY_ALREADY_SUPERSEDED");
    }
  });

  it("superseded memory is excluded from list()", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1" }));
    await store.save(entry({ id: "mem_2", content: "Another memory." }));
    await store.supersede("project-a", "mem_1");
    const memories = await store.list("project-a");
    expect(memories).toHaveLength(1);
    expect(memories[0]!.id).toBe("mem_2");
  });

  it("superseded memory is excluded from search()", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1", content: "Use standalone components." }));
    await store.save(entry({ id: "mem_2", content: "Use standalone components v2." }));
    await store.supersede("project-a", "mem_1");
    const results = await store.search("project-a", "standalone");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("mem_2");
  });
});
