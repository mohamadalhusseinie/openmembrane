import type Database from "better-sqlite3";
import type { MemoryEntry, MemorySearchOptions, MemoryStore } from "@openmembrane/core";
import { OpenMembraneError } from "@openmembrane/core";
import { nowIso } from "@openmembrane/shared";
import { searchEntries } from "../searchEntries";

interface RawMemoryRow {
  id: string;
  projectId: string;
  type: string;
  content: string;
  scope: string;
  confidence: string;
  sensitivity: string;
  source: string;
  reason: string;
  tags: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  supersededBy: string | null;
  supersededAt: string | null;
}

function deserializeMemory(row: RawMemoryRow): MemoryEntry {
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
    tags: JSON.parse(row.tags),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.approvedAt !== null ? { approvedAt: row.approvedAt } : {}),
    ...(row.supersededBy !== null ? { supersededBy: row.supersededBy } : {}),
    ...(row.supersededAt !== null ? { supersededAt: row.supersededAt } : {}),
  } as MemoryEntry;
}

export class SqliteMemoryStore implements MemoryStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async list(projectId: string): Promise<MemoryEntry[]> {
    const rows = this.db
      .prepare("SELECT * FROM memories WHERE projectId = ? AND status = 'active'")
      .all(projectId) as RawMemoryRow[];
    return rows.map(deserializeMemory);
  }

  async findById(projectId: string, memoryId: string): Promise<MemoryEntry | undefined> {
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ? AND projectId = ?")
      .get(memoryId, projectId) as RawMemoryRow | undefined;
    return row !== undefined ? deserializeMemory(row) : undefined;
  }

  async save(entry: MemoryEntry): Promise<MemoryEntry> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memories
         (id, projectId, type, content, scope, confidence, sensitivity, source,
          reason, tags, status, createdAt, updatedAt, approvedAt, supersededBy, supersededAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.projectId,
        entry.type,
        entry.content,
        entry.scope,
        entry.confidence,
        entry.sensitivity,
        JSON.stringify(entry.source),
        entry.reason,
        JSON.stringify(entry.tags),
        entry.status,
        entry.createdAt,
        entry.updatedAt,
        entry.approvedAt ?? null,
        entry.supersededBy ?? null,
        entry.supersededAt ?? null
      );
    return entry;
  }

  async supersede(projectId: string, memoryId: string, supersededBy?: string): Promise<MemoryEntry> {
    const existing = await this.findById(projectId, memoryId);
    if (existing === undefined) {
      throw new OpenMembraneError({
        code: "MEMORY_NOT_FOUND",
        message: `Memory ${memoryId} was not found.`,
        safeMessage: "The memory was not found.",
        details: { memoryId },
      });
    }

    if (existing.status === "superseded") {
      throw new OpenMembraneError({
        code: "MEMORY_ALREADY_SUPERSEDED",
        message: `Memory ${memoryId} is already superseded.`,
        safeMessage: "The memory is already superseded.",
        details: { memoryId },
      });
    }

    const updated: MemoryEntry = {
      ...existing,
      status: "superseded",
      supersededAt: nowIso(),
      ...(supersededBy !== undefined ? { supersededBy } : {}),
    };
    await this.save(updated);
    return updated;
  }

  async search(projectId: string, query: string, options: MemorySearchOptions = {}): Promise<MemoryEntry[]> {
    const rows = await this.list(projectId);
    return searchEntries(rows, query, options)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .slice(0, options.limit === null ? undefined : options.limit ?? 20);
  }
}
