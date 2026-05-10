import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryEntry, MemorySearchOptions, MemoryScope, MemoryStore, MemoryType } from "@openmembrain/core";
import { OpenMembrainError } from "@openmembrain/core";
import { nowIso } from "@openmembrain/shared";
import type { TypeIndex } from "./indexTypes";
import { readJsonObject } from "./jsonFile";
import { listEntries, readEntry, updateIndexesForEntry, writeEntry } from "./directoryStore";
import { migrateMemories } from "./migrate";

export class JsonMemoryStore implements MemoryStore {
  private readonly baseDir: string;
  private readonly legacyPath: string;
  private migrated = false;

  constructor(baseDir: string) {
    this.baseDir = join(baseDir, "memories");
    this.legacyPath = join(baseDir, "memories.json");
  }

  private async ensureMigrated(): Promise<void> {
    if (!this.migrated) {
      await migrateMemories(this.legacyPath, this.baseDir);
      this.migrated = true;
    }
  }

  async list(projectId: string): Promise<MemoryEntry[]> {
    await this.ensureMigrated();
    const entries = await listEntries<MemoryEntry>(this.baseDir);
    return entries.filter((m) => m.projectId === projectId && m.status === "active");
  }

  async findById(projectId: string, memoryId: string): Promise<MemoryEntry | undefined> {
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
      const match = typeIndex.entries.find((e) => e.id === memoryId && e.projectId === projectId);
      if (match !== undefined) {
        return readEntry<MemoryEntry>(this.baseDir, typeDir as MemoryType, match.scope, memoryId);
      }
    }

    return undefined;
  }

  async save(entry: MemoryEntry): Promise<MemoryEntry> {
    await this.ensureMigrated();
    await writeEntry(this.baseDir, entry);
    await updateIndexesForEntry(this.baseDir, entry);
    return entry;
  }

  async supersede(projectId: string, memoryId: string, supersededBy?: string): Promise<MemoryEntry> {
    await this.ensureMigrated();
    const existing = await this.findById(projectId, memoryId);
    if (existing === undefined) {
      throw new OpenMembrainError({
        code: "MEMORY_NOT_FOUND",
        message: `Memory ${memoryId} was not found.`,
        safeMessage: "The memory was not found.",
        details: { memoryId },
      });
    }

    if (existing.status === "superseded") {
      throw new OpenMembrainError({
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
    await writeEntry(this.baseDir, updated);
    await updateIndexesForEntry(this.baseDir, updated);
    return updated;
  }

  async search(projectId: string, query: string, options: MemorySearchOptions = {}): Promise<MemoryEntry[]> {
    await this.ensureMigrated();
    const queryTokens = tokenize(query);
    const rows = await this.list(projectId);
    const filtered = rows.filter((memory) => {
      if (options.scopes && !options.scopes.includes(memory.scope)) return false;
      if (options.types && !options.types.includes(memory.type)) return false;
      if (options.tags && !options.tags.some((tag) => memory.tags.includes(tag))) return false;
      if (queryTokens.length === 0) return true;
      const haystack = tokenize([memory.content, memory.type, memory.scope, ...memory.tags].join(" "));
      return queryTokens.some((token) => haystack.includes(token));
    });

    return filtered
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, options.limit ?? 20);
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}
