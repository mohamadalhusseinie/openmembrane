import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../packages/storage/src/sqlite/db";
import { SqlitePendingCandidateStore } from "../../packages/storage/src/sqlite/SqlitePendingCandidateStore";
import { candidate } from "./helpers";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";

function tmpDbPath(): string {
  return join(tmpdir(), `openmembrane-test-${randomUUID()}.db`);
}

describe("SqlitePendingCandidateStore", () => {
  let dbPath: string;
  let db: Database.Database;
  let store: SqlitePendingCandidateStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = openDatabase(dbPath);
    store = new SqlitePendingCandidateStore(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-wal"); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-shm"); } catch { /* ignore */ }
  });

  it("saves and retrieves a candidate", async () => {
    const c = candidate();
    await store.save(c);
    const found = await store.findById(c.projectId, c.id);
    expect(found).toEqual(c);
  });

  it("list returns candidates for the given project", async () => {
    await store.save(candidate({ id: "cand_1", projectId: "p1" }));
    await store.save(candidate({ id: "cand_2", projectId: "p2" }));

    const result = await store.list("p1");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("cand_1");
  });

  it("findById returns undefined for missing candidate", async () => {
    const found = await store.findById("p1", "nonexistent");
    expect(found).toBeUndefined();
  });

  it("remove deletes a candidate", async () => {
    const c = candidate();
    await store.save(c);
    await store.remove(c.projectId, c.id);
    const found = await store.findById(c.projectId, c.id);
    expect(found).toBeUndefined();
  });

  it("remove is a no-op for missing candidate", async () => {
    await expect(store.remove("p1", "nonexistent")).resolves.toBeUndefined();
  });

  it("save overwrites existing candidate with same id", async () => {
    const c = candidate();
    await store.save(c);
    const updated = candidate({ content: "updated content" });
    await store.save(updated);
    const found = await store.findById(c.projectId, c.id);
    expect(found!.content).toBe("updated content");
  });
});
