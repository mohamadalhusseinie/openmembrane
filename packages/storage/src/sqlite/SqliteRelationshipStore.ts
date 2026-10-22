import type Database from "better-sqlite3";
import type { Relationship, RelationshipListOptions, RelationshipStore } from "@openmembrane/core";

interface RawRelationshipRow {
  id: string;
  projectId: string;
  sourceKind: string;
  sourceId: string;
  targetKind: string;
  targetId: string;
  type: string;
  origin: string;
  confidence: number;
  rationale: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  removedAt: string | null;
}

function deserialize(row: RawRelationshipRow): Relationship {
  return {
    id: row.id,
    projectId: row.projectId,
    source: { kind: row.sourceKind, id: row.sourceId },
    target: { kind: row.targetKind, id: row.targetId },
    type: row.type,
    origin: row.origin,
    confidence: row.confidence,
    rationale: row.rationale,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.removedAt !== null ? { removedAt: row.removedAt } : {}),
  } as Relationship;
}

export class SqliteRelationshipStore implements RelationshipStore {
  constructor(private readonly db: Database.Database) {}

  async list(projectId: string, options: RelationshipListOptions = {}): Promise<Relationship[]> {
    const rows = this.db
      .prepare(`SELECT * FROM relationships WHERE projectId = ?${options.includeRemoved ? "" : " AND status = 'active'"} ORDER BY createdAt, id`)
      .all(projectId) as RawRelationshipRow[];
    return rows.map(deserialize);
  }

  async findById(projectId: string, relationshipId: string): Promise<Relationship | undefined> {
    const row = this.db.prepare("SELECT * FROM relationships WHERE projectId = ? AND id = ?").get(projectId, relationshipId) as RawRelationshipRow | undefined;
    return row ? deserialize(row) : undefined;
  }

  async save(relationship: Relationship): Promise<Relationship> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO relationships
         (id, projectId, sourceKind, sourceId, targetKind, targetId, type, origin, confidence, rationale, status, createdAt, updatedAt, removedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        relationship.id,
        relationship.projectId,
        relationship.source.kind,
        relationship.source.id,
        relationship.target.kind,
        relationship.target.id,
        relationship.type,
        relationship.origin,
        relationship.confidence,
        relationship.rationale,
        relationship.status,
        relationship.createdAt,
        relationship.updatedAt,
        relationship.removedAt ?? null,
      );
    return relationship;
  }
}
