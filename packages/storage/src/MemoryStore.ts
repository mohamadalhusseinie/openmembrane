import { join } from "node:path";
import type { MemoryEntry, MemorySearchOptions, MemoryStore } from "@openmembrain/core";
import { OpenMembrainError } from "@openmembrain/core";
import { nowIso } from "@openmembrain/shared";
import { readJsonArray, writeJsonArray } from "./jsonFile";

export class JsonMemoryStore implements MemoryStore {
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = join(baseDir, "memories.json");
  }

  async list(projectId: string): Promise<MemoryEntry[]> {
    const rows = await readJsonArray<MemoryEntry>(this.filePath);
    return rows.filter((memory) => memory.projectId === projectId && memory.status === "active");
  }

  async findById(projectId: string, memoryId: string): Promise<MemoryEntry | undefined> {
    return (await this.list(projectId)).find((memory) => memory.id === memoryId);
  }

  async save(entry: MemoryEntry): Promise<MemoryEntry> {
    const rows = await readJsonArray<MemoryEntry>(this.filePath);
    const index = rows.findIndex((memory) => memory.id === entry.id);
    if (index >= 0) {
      rows[index] = entry;
    } else {
      rows.push(entry);
    }
    await writeJsonArray(this.filePath, rows);
    return entry;
  }

  async supersede(projectId: string, memoryId: string, supersededBy?: string): Promise<MemoryEntry> {
    const rows = await readJsonArray<MemoryEntry>(this.filePath);
    const index = rows.findIndex((memory) => memory.id === memoryId && memory.projectId === projectId);
    if (index < 0) {
      throw new OpenMembrainError({
        code: "MEMORY_NOT_FOUND",
        message: `Memory ${memoryId} was not found.`,
        safeMessage: "The memory was not found.",
        details: { memoryId },
      });
    }

    const memory = rows[index]!;
    if (memory.status === "superseded") {
      throw new OpenMembrainError({
        code: "MEMORY_ALREADY_SUPERSEDED",
        message: `Memory ${memoryId} is already superseded.`,
        safeMessage: "The memory is already superseded.",
        details: { memoryId },
      });
    }

    const updated: MemoryEntry = {
      ...memory,
      status: "superseded",
      supersededAt: nowIso(),
      ...(supersededBy !== undefined ? { supersededBy } : {}),
    };
    rows[index] = updated;
    await writeJsonArray(this.filePath, rows);
    return updated;
  }

  async search(projectId: string, query: string, options: MemorySearchOptions = {}): Promise<MemoryEntry[]> {
    const queryTokens = tokenize(query);
    const rows = await this.list(projectId);
    const filtered = rows.filter((memory) => {
      if (options.scopes && !options.scopes.includes(memory.scope)) {
        return false;
      }
      if (options.types && !options.types.includes(memory.type)) {
        return false;
      }
      if (options.tags && !options.tags.some((tag) => memory.tags.includes(tag))) {
        return false;
      }
      if (queryTokens.length === 0) {
        return true;
      }

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
