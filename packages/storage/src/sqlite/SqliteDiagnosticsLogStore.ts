import type Database from "better-sqlite3";
import type { DiagnosticEvent, DiagnosticQuery, DiagnosticsLogStore } from "@openmembrane/core";

interface RawDiagnosticRow {
  id: string;
  projectId: string;
  severity: string;
  code: string;
  message: string;
  operation: string | null;
  source: string | null;
  entityId: string | null;
  createdAt: string;
  details: string | null;
}

function deserializeDiagnosticEvent(row: RawDiagnosticRow): DiagnosticEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    severity: row.severity,
    code: row.code,
    message: row.message,
    createdAt: row.createdAt,
    ...(row.operation !== null ? { operation: row.operation } : {}),
    ...(row.source !== null ? { source: row.source } : {}),
    ...(row.entityId !== null ? { entityId: row.entityId } : {}),
    ...(row.details !== null ? { details: JSON.parse(row.details) } : {}),
  } as DiagnosticEvent;
}

export class SqliteDiagnosticsLogStore implements DiagnosticsLogStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async append(event: DiagnosticEvent): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO diagnostics_log
         (id, projectId, severity, code, message, operation, source, entityId, createdAt, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.projectId,
        event.severity,
        event.code,
        event.message,
        event.operation ?? null,
        event.source ?? null,
        event.entityId ?? null,
        event.createdAt,
        event.details !== undefined ? JSON.stringify(event.details) : null
      );
  }

  async list(projectId: string, query: DiagnosticQuery = {}): Promise<DiagnosticEvent[]> {
    const rows = this.db
      .prepare("SELECT * FROM diagnostics_log WHERE projectId = ?")
      .all(projectId) as RawDiagnosticRow[];

    return rows
      .map(deserializeDiagnosticEvent)
      .filter((event) => (query.severity !== undefined ? event.severity === query.severity : true))
      .filter((event) => (query.code !== undefined ? event.code === query.code : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, query.limit ?? 100);
  }
}
