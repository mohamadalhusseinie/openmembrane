import type Database from "better-sqlite3";
import { processedSessionFingerprint, type AuditEvent, type AuditLogStore } from "@openmembrane/core";

interface RawAuditRow {
  id: string;
  projectId: string;
  type: string;
  entityId: string | null;
  createdAt: string;
  details: string | null;
}

function deserializeAuditEvent(row: RawAuditRow): AuditEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    createdAt: row.createdAt,
    ...(row.entityId !== null ? { entityId: row.entityId } : {}),
    ...(row.details !== null ? { details: JSON.parse(row.details) } : {}),
  } as AuditEvent;
}

export class SqliteAuditLogStore implements AuditLogStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async append(event: AuditEvent): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO audit_log (id, projectId, type, entityId, createdAt, details)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.id,
          event.projectId,
          event.type,
          event.entityId ?? null,
          event.createdAt,
          event.details !== undefined ? JSON.stringify(event.details) : null
        );
      const fingerprint = processedSessionFingerprint(event);
      if (fingerprint) {
        this.db.prepare("INSERT OR IGNORE INTO session_dispositions (projectId, fingerprint) VALUES (?, ?)")
          .run(event.projectId, fingerprint);
      }
    })();
  }

  async findProcessedSessionFingerprints(projectId: string, fingerprints: string[]): Promise<string[]> {
    const found: string[] = [];
    const query = this.db.prepare("SELECT fingerprint FROM session_dispositions WHERE projectId = ? AND fingerprint = ?");
    for (const fingerprint of new Set(fingerprints)) {
      if (query.get(projectId, fingerprint)) found.push(fingerprint);
    }
    return found;
  }

  async list(projectId: string): Promise<AuditEvent[]> {
    const rows = this.db
      .prepare("SELECT * FROM audit_log WHERE projectId = ?")
      .all(projectId) as RawAuditRow[];
    return rows.map(deserializeAuditEvent);
  }
}
