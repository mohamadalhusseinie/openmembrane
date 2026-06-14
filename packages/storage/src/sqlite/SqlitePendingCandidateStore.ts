import type Database from "better-sqlite3";
import type { MemoryCandidate, PendingCandidateStore } from "@openmembrane/core";

interface RawPendingRow {
  id: string;
  projectId: string;
  type: string;
  content: string;
  scope: string;
  confidence: string;
  sensitivity: string;
  source: string;
  reason: string;
  recommendedAction: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
  rejectionReason: string | null;
  duplicateOf: string | null;
  conflictWith: string | null;
}

function deserializeCandidate(row: RawPendingRow): MemoryCandidate {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    content: row.content,
    scope: row.scope,
    confidence: row.confidence,
    sensitivity: row.sensitivity,
    source: JSON.parse(row.source),
    reason: row.reason,
    recommendedAction: row.recommendedAction,
    tags: JSON.parse(row.tags),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.rejectionReason !== null ? { rejectionReason: row.rejectionReason } : {}),
    ...(row.duplicateOf !== null ? { duplicateOf: row.duplicateOf } : {}),
    ...(row.conflictWith !== null ? { conflictWith: JSON.parse(row.conflictWith) } : {}),
  } as MemoryCandidate;
}

export class SqlitePendingCandidateStore implements PendingCandidateStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async list(projectId: string): Promise<MemoryCandidate[]> {
    const rows = this.db
      .prepare("SELECT * FROM pending_candidates WHERE projectId = ?")
      .all(projectId) as RawPendingRow[];
    return rows.map(deserializeCandidate);
  }

  async findById(projectId: string, candidateId: string): Promise<MemoryCandidate | undefined> {
    const row = this.db
      .prepare("SELECT * FROM pending_candidates WHERE id = ? AND projectId = ?")
      .get(candidateId, projectId) as RawPendingRow | undefined;
    return row !== undefined ? deserializeCandidate(row) : undefined;
  }

  async save(candidate: MemoryCandidate): Promise<MemoryCandidate> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO pending_candidates
         (id, projectId, type, content, scope, confidence, sensitivity, source,
          reason, recommendedAction, tags, createdAt, updatedAt,
          rejectionReason, duplicateOf, conflictWith)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        candidate.id,
        candidate.projectId,
        candidate.type,
        candidate.content,
        candidate.scope,
        candidate.confidence,
        candidate.sensitivity,
        JSON.stringify(candidate.source),
        candidate.reason,
        candidate.recommendedAction,
        JSON.stringify(candidate.tags),
        candidate.createdAt,
        candidate.updatedAt,
        candidate.rejectionReason ?? null,
        candidate.duplicateOf ?? null,
        candidate.conflictWith !== undefined ? JSON.stringify(candidate.conflictWith) : null
      );
    return candidate;
  }

  async remove(projectId: string, candidateId: string): Promise<void> {
    this.db
      .prepare("DELETE FROM pending_candidates WHERE id = ? AND projectId = ?")
      .run(candidateId, projectId);
  }
}
