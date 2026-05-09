import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { JsonMemoryStore } from "@openmembrain/storage";
import { entry } from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createStore(): Promise<JsonMemoryStore> {
  const dir = await mkdtemp(join(tmpdir(), "openmembrain-search-test-"));
  tempDirs.push(dir);
  return new JsonMemoryStore(dir);
}

describe("JsonMemoryStore.search", () => {
  it("filters by scope", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1", scope: "frontend" }));
    await store.save(entry({ id: "mem_2", scope: "backend", content: "Backend content." }));
    const results = await store.search("project-a", "", { scopes: ["frontend"] });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("mem_1");
  });

  it("filters by type", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1", type: "coding_rule" }));
    await store.save(entry({ id: "mem_2", type: "security_rule", content: "Security content." }));
    const results = await store.search("project-a", "", { types: ["coding_rule"] });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("mem_1");
  });

  it("filters by tag (any overlap)", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1", tags: ["react", "frontend"] }));
    await store.save(entry({ id: "mem_2", tags: ["angular", "frontend"], content: "Angular." }));
    await store.save(entry({ id: "mem_3", tags: ["postgres"], content: "Postgres." }));
    const results = await store.search("project-a", "", { tags: ["react"] });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("mem_1");
  });

  it("returns all memories for empty query", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1" }));
    await store.save(entry({ id: "mem_2", content: "Different content." }));
    const results = await store.search("project-a", "");
    expect(results).toHaveLength(2);
  });

  it("applies default limit of 20", async () => {
    const store = await createStore();
    for (let i = 0; i < 25; i++) {
      await store.save(entry({ id: `mem_${i}`, content: `Memory number ${i} about widgets.` }));
    }
    const results = await store.search("project-a", "");
    expect(results).toHaveLength(20);
  });

  it("respects custom limit", async () => {
    const store = await createStore();
    for (let i = 0; i < 10; i++) {
      await store.save(entry({ id: `mem_${i}`, content: `Memory ${i} about widgets.` }));
    }
    const results = await store.search("project-a", "", { limit: 3 });
    expect(results).toHaveLength(3);
  });

  it("sorts results by updatedAt descending", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_old", updatedAt: "2026-01-01T00:00:00.000Z" }));
    await store.save(entry({ id: "mem_new", updatedAt: "2026-06-01T00:00:00.000Z", content: "Different." }));
    await store.save(entry({ id: "mem_mid", updatedAt: "2026-03-01T00:00:00.000Z", content: "Another." }));
    const results = await store.search("project-a", "");
    expect(results.map((r) => r.id)).toEqual(["mem_new", "mem_mid", "mem_old"]);
  });

  it("returns empty array when no memories match", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1", content: "React components use hooks." }));
    const results = await store.search("project-a", "kubernetes");
    expect(results).toHaveLength(0);
  });

  it("matches query tokens against content, type, scope, and tags", async () => {
    const store = await createStore();
    await store.save(entry({ id: "mem_1", content: "Deploy via Kubernetes.", tags: ["devops"] }));
    await store.save(entry({ id: "mem_2", content: "React hooks pattern." }));
    const results = await store.search("project-a", "kubernetes");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("mem_1");
  });
});
