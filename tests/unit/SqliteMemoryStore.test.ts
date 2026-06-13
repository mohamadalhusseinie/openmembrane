import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../packages/storage/src/sqlite/db";
import { SqliteMemoryStore } from "../../packages/storage/src/sqlite/SqliteMemoryStore";
import { entry } from "./helpers";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";

function tmpDbPath(): string {
  return join(tmpdir(), `openmembrane-test-${randomUUID()}.db`);
}

describe("SqliteMemoryStore", () => {
  let dbPath: string;
  let db: Database.Database;
  let store: SqliteMemoryStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = openDatabase(dbPath);
    store = new SqliteMemoryStore(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-wal"); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-shm"); } catch { /* ignore */ }
  });

  it("saves and retrieves a memory entry", async () => {
    const e = entry();
    await store.save(e);
    const found = await store.findById(e.projectId, e.id);
    expect(found).toEqual(e);
  });

  it("list returns only active entries for the given project", async () => {
    await store.save(entry({ id: "mem_1", projectId: "p1" }));
    await store.save(entry({ id: "mem_2", projectId: "p1", status: "superseded" }));
    await store.save(entry({ id: "mem_3", projectId: "p2" }));

    const result = await store.list("p1");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("mem_1");
  });

  it("findById returns undefined for missing entry", async () => {
    const found = await store.findById("p1", "nonexistent");
    expect(found).toBeUndefined();
  });

  it("save overwrites existing entry with same id", async () => {
    const e = entry();
    await store.save(e);
    const updated = entry({ content: "updated content" });
    await store.save(updated);
    const found = await store.findById(e.projectId, e.id);
    expect(found!.content).toBe("updated content");
  });

  it("supersede marks entry as superseded", async () => {
    const e = entry();
    await store.save(e);
    const result = await store.supersede(e.projectId, e.id, "mem_replacement");
    expect(result.status).toBe("superseded");
    expect(result.supersededBy).toBe("mem_replacement");
    expect(result.supersededAt).toBeDefined();
  });

  it("supersede throws for missing entry", async () => {
    await expect(store.supersede("p1", "nonexistent")).rejects.toThrow("not found");
  });

  it("supersede throws for already superseded entry", async () => {
    const e = entry();
    await store.save(e);
    await store.supersede(e.projectId, e.id);
    await expect(store.supersede(e.projectId, e.id)).rejects.toThrow("already superseded");
  });

  it("search filters by query tokens", async () => {
    await store.save(entry({ id: "mem_1", content: "use vitest for testing" }));
    await store.save(entry({ id: "mem_2", content: "deploy with docker" }));

    const results = await store.search("project-a", "vitest");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("mem_1");
  });

  it("search filters by scope", async () => {
    await store.save(entry({ id: "mem_1", scope: "frontend" }));
    await store.save(entry({ id: "mem_2", scope: "backend" }));

    const results = await store.search("project-a", "", { scopes: ["backend"] });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("mem_2");
  });

  it("search respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.save(entry({ id: `mem_${i}`, content: "common keyword" }));
    }
    const results = await store.search("project-a", "common", { limit: 2 });
    expect(results).toHaveLength(2);
  });
});
