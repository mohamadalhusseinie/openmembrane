import { join } from "node:path";
import type { AuditLogStore, DiagnosticsLogStore, MemoryStore, PendingCandidateStore } from "@openmembrane/core";
import { JsonMemoryStore } from "./MemoryStore";
import { JsonPendingCandidateStore } from "./PendingCandidateStore";
import { JsonAuditLogStore } from "./AuditLogStore";
import { JsonDiagnosticsLogStore } from "./DiagnosticsLogStore";

export type StorageBackend = "json" | "sqlite";

export interface StorageBackendConfig {
  backend: StorageBackend;
  baseDir: string;
}

export interface StoreSet {
  memoryStore: MemoryStore;
  pendingCandidateStore: PendingCandidateStore;
  auditLogStore: AuditLogStore;
  diagnosticsLogStore: DiagnosticsLogStore;
  close?: () => void;
}

export async function createStores(config: StorageBackendConfig): Promise<StoreSet> {
  if (config.backend === "sqlite") {
    const { openDatabase } = await import("./sqlite/db");
    const { SqliteMemoryStore } = await import("./sqlite/SqliteMemoryStore");
    const { SqlitePendingCandidateStore } = await import("./sqlite/SqlitePendingCandidateStore");
    const { SqliteAuditLogStore } = await import("./sqlite/SqliteAuditLogStore");
    const { SqliteDiagnosticsLogStore } = await import("./sqlite/SqliteDiagnosticsLogStore");

    const dbPath = join(config.baseDir, "openmembrane.db");
    const db = openDatabase(dbPath);
    return {
      memoryStore: new SqliteMemoryStore(db),
      pendingCandidateStore: new SqlitePendingCandidateStore(db),
      auditLogStore: new SqliteAuditLogStore(db),
      diagnosticsLogStore: new SqliteDiagnosticsLogStore(db),
      close: () => db.close(),
    };
  }

  return {
    memoryStore: new JsonMemoryStore(config.baseDir),
    pendingCandidateStore: new JsonPendingCandidateStore(config.baseDir),
    auditLogStore: new JsonAuditLogStore(config.baseDir),
    diagnosticsLogStore: new JsonDiagnosticsLogStore(config.baseDir),
  };
}
