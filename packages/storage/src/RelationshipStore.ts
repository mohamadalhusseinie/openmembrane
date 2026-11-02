import { join } from "node:path";
import type { Relationship, RelationshipListOptions, RelationshipStore } from "@openmembrane/core";
import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { readJsonArray, writeJsonArray } from "./jsonFile";

export class JsonRelationshipStore implements RelationshipStore {
  private readonly filePath: string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(baseDir: string) {
    this.filePath = join(baseDir, "relationships.json");
  }

  async list(projectId: string, options: RelationshipListOptions = {}): Promise<Relationship[]> {
    await this.writes;
    const rows = await readJsonArray<Relationship>(this.filePath);
    return rows.filter((row) => row.projectId === projectId && (options.includeRemoved || row.status === "active"));
  }

  async findById(projectId: string, relationshipId: string): Promise<Relationship | undefined> {
    await this.writes;
    const rows = await readJsonArray<Relationship>(this.filePath);
    return rows.find((row) => row.projectId === projectId && row.id === relationshipId);
  }

  async save(relationship: Relationship): Promise<Relationship> {
    await this.saveMany([relationship]);
    return relationship;
  }

  saveMany(relationships: Relationship[]): Promise<Relationship[]> {
    if (relationships.length === 0) return Promise.resolve([]);
    const write = this.writes.then(async () => {
      const rows = await readJsonArray<Relationship>(this.filePath);
      const positions = new Map(rows.map((row, index) => [`${row.projectId}\u0000${row.id}`, index]));
      for (const relationship of relationships) {
        const key = `${relationship.projectId}\u0000${relationship.id}`;
        const index = positions.get(key);
        if (index !== undefined) rows[index] = relationship;
        else positions.set(key, rows.push(relationship) - 1);
      }
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeJsonArray(temporary, rows);
        await rename(temporary, this.filePath);
      } finally {
        await rm(temporary, { force: true });
      }
      return relationships;
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
}
