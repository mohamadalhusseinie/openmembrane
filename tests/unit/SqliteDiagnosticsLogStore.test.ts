import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import type { DiagnosticEvent } from "@openmembrane/core";
import { openDatabase } from "../../packages/storage/src/sqlite/db";
import { SqliteDiagnosticsLogStore } from "../../packages/storage/src/sqlite/SqliteDiagnosticsLogStore";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";

function tmpDbPath(): string {
  return join(tmpdir(), `openmembrane-test-${randomUUID()}.db`);
}

function diagEvent(overrides: Partial<DiagnosticEvent> = {}): DiagnosticEvent {
  return {
    id: "diag_1",
    projectId: "project-a",
    severity: "info",
    code: "EXTRACTION_COMPLETE",
    message: "Extraction completed successfully.",
    createdAt: "2026-05-08T00:00:00.000Z",
    ...overrides,
  } as DiagnosticEvent;
}

describe("SqliteDiagnosticsLogStore", () => {
  let dbPath: string;
  let db: Database.Database;
  let store: SqliteDiagnosticsLogStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = openDatabase(dbPath);
    store = new SqliteDiagnosticsLogStore(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-wal"); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-shm"); } catch { /* ignore */ }
  });

  it("appends and lists a diagnostic event", async () => {
    const event = diagEvent();
    await store.append(event);
    const result = await store.list("project-a");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("diag_1");
  });

  it("list filters by projectId", async () => {
    await store.append(diagEvent({ id: "d1", projectId: "p1" }));
    await store.append(diagEvent({ id: "d2", projectId: "p2" }));
    const result = await store.list("p1");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("d1");
  });

  it("filters by severity", async () => {
    await store.append(diagEvent({ id: "d1", severity: "info" }));
    await store.append(diagEvent({ id: "d2", severity: "error" }));
    const result = await store.list("project-a", { severity: "error" });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("d2");
  });

  it("filters by code", async () => {
    await store.append(diagEvent({ id: "d1", code: "EXTRACTION_COMPLETE" }));
    await store.append(diagEvent({ id: "d2", code: "STORAGE_ERROR" }));
    const result = await store.list("project-a", { code: "STORAGE_ERROR" });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("d2");
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.append(diagEvent({ id: `d_${i}` }));
    }
    const result = await store.list("project-a", { limit: 2 });
    expect(result).toHaveLength(2);
  });

  it("preserves optional fields", async () => {
    const event = diagEvent({
      operation: "extraction",
      source: "core",
      entityId: "mem_1",
      details: { key: "value" },
    });
    await store.append(event);
    const result = await store.list("project-a");
    expect(result[0]!.operation).toBe("extraction");
    expect(result[0]!.source).toBe("core");
    expect(result[0]!.entityId).toBe("mem_1");
    expect(result[0]!.details).toEqual({ key: "value" });
  });

  it("omits optional fields when not provided", async () => {
    await store.append(diagEvent());
    const result = await store.list("project-a");
    expect(result[0]!.operation).toBeUndefined();
    expect(result[0]!.source).toBeUndefined();
    expect(result[0]!.entityId).toBeUndefined();
    expect(result[0]!.details).toBeUndefined();
  });
});
