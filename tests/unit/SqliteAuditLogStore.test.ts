import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import type { AuditEvent } from "@openmembrane/core";
import { openDatabase } from "../../packages/storage/src/sqlite/db";
import { SqliteAuditLogStore } from "../../packages/storage/src/sqlite/SqliteAuditLogStore";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";

function tmpDbPath(): string {
  return join(tmpdir(), `openmembrane-test-${randomUUID()}.db`);
}

function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "audit_1",
    projectId: "project-a",
    type: "memory_saved",
    createdAt: "2026-05-08T00:00:00.000Z",
    ...overrides,
  } as AuditEvent;
}

describe("SqliteAuditLogStore", () => {
  let dbPath: string;
  let db: Database.Database;
  let store: SqliteAuditLogStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = openDatabase(dbPath);
    store = new SqliteAuditLogStore(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-wal"); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-shm"); } catch { /* ignore */ }
  });

  it("appends and lists an audit event", async () => {
    const event = auditEvent();
    await store.append(event);
    const result = await store.list("project-a");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("audit_1");
    expect(result[0]!.type).toBe("memory_saved");
  });

  it("list filters by projectId", async () => {
    await store.append(auditEvent({ id: "a1", projectId: "p1" }));
    await store.append(auditEvent({ id: "a2", projectId: "p2" }));
    const result = await store.list("p1");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a1");
  });

  it("preserves details as JSON", async () => {
    const event = auditEvent({ details: { key: "value", count: 42 } });
    await store.append(event);
    const result = await store.list("project-a");
    expect(result[0]!.details).toEqual({ key: "value", count: 42 });
  });

  it("preserves entityId", async () => {
    const event = auditEvent({ entityId: "mem_123" });
    await store.append(event);
    const result = await store.list("project-a");
    expect(result[0]!.entityId).toBe("mem_123");
  });

  it("omits entityId when not provided", async () => {
    const event = auditEvent();
    await store.append(event);
    const result = await store.list("project-a");
    expect(result[0]!.entityId).toBeUndefined();
  });
});
