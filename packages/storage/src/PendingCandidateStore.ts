import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryCandidate, MemoryType, PendingCandidateStore } from "@openmembrain/core";
import type { TypeIndex } from "./indexTypes";
import { readJsonObject } from "./jsonFile";
import { listEntries, readEntry, removeEntry, removeFromIndexes, updateIndexesForEntry, writeEntry } from "./directoryStore";
import { migratePending } from "./migrate";

export class JsonPendingCandidateStore implements PendingCandidateStore {
  private readonly baseDir: string;
  private readonly legacyPath: string;
  private migrated = false;

  constructor(baseDir: string) {
    this.baseDir = join(baseDir, "pending");
    this.legacyPath = join(baseDir, "pending-candidates.json");
  }

  private async ensureMigrated(): Promise<void> {
    if (!this.migrated) {
      await migratePending(this.legacyPath, this.baseDir);
      this.migrated = true;
    }
  }

  async list(projectId: string): Promise<MemoryCandidate[]> {
    await this.ensureMigrated();
    const entries = await listEntries<MemoryCandidate>(this.baseDir);
    return entries.filter((c) => c.projectId === projectId);
  }

  async findById(projectId: string, candidateId: string): Promise<MemoryCandidate | undefined> {
    await this.ensureMigrated();
    let typeDirs: string[];
    try {
      typeDirs = await readdir(this.baseDir);
    } catch {
      return undefined;
    }

    for (const typeDir of typeDirs) {
      if (typeDir.endsWith(".json") || typeDir.startsWith("_")) continue;
      const typeIndex = await readJsonObject<TypeIndex>(join(this.baseDir, typeDir, "_index.json"));
      if (typeIndex === undefined) continue;
      const match = typeIndex.entries.find((e) => e.id === candidateId && e.projectId === projectId);
      if (match !== undefined) {
        return readEntry<MemoryCandidate>(this.baseDir, typeDir as MemoryType, match.scope, candidateId);
      }
    }

    return undefined;
  }

  async save(candidate: MemoryCandidate): Promise<MemoryCandidate> {
    await this.ensureMigrated();
    await writeEntry(this.baseDir, candidate);
    await updateIndexesForEntry(this.baseDir, candidate);
    return candidate;
  }

  async remove(projectId: string, candidateId: string): Promise<void> {
    await this.ensureMigrated();
    const found = await this.findById(projectId, candidateId);
    if (found === undefined) return;
    await removeEntry(this.baseDir, found.type, found.scope, candidateId);
    await removeFromIndexes(this.baseDir, found.type, candidateId);
  }
}
