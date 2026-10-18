import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export function openDatabase(filePath: string): Database.Database {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.transaction(() => {
    const hasSessionIndex = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_dispositions'").get();
    db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      scope TEXT NOT NULL,
      confidence TEXT NOT NULL,
      sensitivity TEXT NOT NULL,
      source TEXT NOT NULL,
      reason TEXT NOT NULL,
      tags TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      approvedAt TEXT,
      supersededBy TEXT,
      supersededAt TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memories_projectId ON memories(projectId);
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);

    CREATE TABLE IF NOT EXISTS pending_candidates (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      scope TEXT NOT NULL,
      confidence TEXT NOT NULL,
      sensitivity TEXT NOT NULL,
      source TEXT NOT NULL,
      reason TEXT NOT NULL,
      recommendedAction TEXT NOT NULL,
      tags TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      rejectionReason TEXT,
      duplicateOf TEXT,
      conflictWith TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pending_projectId ON pending_candidates(projectId);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      type TEXT NOT NULL,
      entityId TEXT,
      createdAt TEXT NOT NULL,
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_projectId ON audit_log(projectId);

    CREATE TABLE IF NOT EXISTS session_dispositions (
      projectId TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (projectId, fingerprint)
    );

    CREATE TABLE IF NOT EXISTS diagnostics_log (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      severity TEXT NOT NULL,
      code TEXT NOT NULL,
      message TEXT NOT NULL,
      operation TEXT,
      source TEXT,
      entityId TEXT,
      createdAt TEXT NOT NULL,
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_diag_projectId ON diagnostics_log(projectId);
    `);
    if (!hasSessionIndex) {
      db.exec(`
      INSERT OR IGNORE INTO session_dispositions (projectId, fingerprint)
      SELECT projectId, json_extract(details, '$.sessionFingerprint') FROM audit_log
      WHERE length(json_extract(details, '$.sessionFingerprint')) = 64
        AND json_extract(details, '$.sessionFingerprint') NOT GLOB '*[^a-f0-9]*'
        AND (type = 'memory_saved' OR (type = 'candidate_rejected'
          AND (json_extract(details, '$.rejectedByUser') = 1 OR json_extract(details, '$.processedSession') = 1)))
      `);
    }
  })();
}
