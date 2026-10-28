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

  save(relationship: Relationship): Promise<Relationship> {
    const write = this.writes.then(async () => {
      const rows = await readJsonArray<Relationship>(this.filePath);
      const index = rows.findIndex((row) => row.projectId === relationship.projectId && row.id === relationship.id);
      if (index >= 0) rows[index] = relationship;
      else rows.push(relationship);
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeJsonArray(temporary, rows);
        await rename(temporary, this.filePath);
      } finally {
        await rm(temporary, { force: true });
      }
      return relationship;
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
}
