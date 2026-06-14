import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../../packages/storage/src/sqlite/db";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";

function tmpDbPath(): string {
  return join(tmpdir(), `openmembrane-test-${randomUUID()}.db`);
}

describe("openDatabase", () => {
  const paths: string[] = [];

  afterEach(() => {
    for (const p of paths) {
      try { unlinkSync(p); } catch { /* ignore */ }
      try { unlinkSync(p + "-wal"); } catch { /* ignore */ }
      try { unlinkSync(p + "-shm"); } catch { /* ignore */ }
    }
    paths.length = 0;
  });

  it("creates a database with WAL mode enabled", () => {
    const p = tmpDbPath();
    paths.push(p);
    const db = openDatabase(p);
    const mode = db.pragma("journal_mode", { simple: true }) as string;
    expect(mode).toBe("wal");
    db.close();
  });

  it("creates all four tables", () => {
    const p = tmpDbPath();
    paths.push(p);
    const db = openDatabase(p);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("memories");
    expect(names).toContain("pending_candidates");
    expect(names).toContain("audit_log");
    expect(names).toContain("diagnostics_log");
    db.close();
  });

  it("is idempotent — calling openDatabase twice on the same file succeeds", () => {
    const p = tmpDbPath();
    paths.push(p);
    const db1 = openDatabase(p);
    db1.close();
    const db2 = openDatabase(p);
    const tables = db2
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.length).toBeGreaterThanOrEqual(4);
    db2.close();
  });
});
