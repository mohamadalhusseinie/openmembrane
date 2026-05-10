import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryScope, MemoryType } from "@openmembrain/core";
import { readJsonObject, writeJsonObject } from "./jsonFile";
import type { MasterIndex, TypeIndex, TypeIndexEntry } from "./indexTypes";
import { emptyMasterIndex, emptyTypeIndex } from "./indexTypes";

export interface HasTypeAndScope {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function entryPath(baseDir: string, type: string, scope: string, id: string): string {
  return join(baseDir, type, scope, `${id}.json`);
}

export async function writeEntry<T extends HasTypeAndScope>(baseDir: string, data: T): Promise<void> {
  await writeJsonObject(entryPath(baseDir, data.type, data.scope, data.id), data);
}

export async function readEntry<T extends HasTypeAndScope>(
  baseDir: string,
  type: MemoryType,
  scope: MemoryScope,
  id: string
): Promise<T | undefined> {
  return readJsonObject<T>(entryPath(baseDir, type, scope, id));
}

export async function removeEntry(
  baseDir: string,
  type: MemoryType,
  scope: MemoryScope,
  id: string
): Promise<void> {
  try {
    await rm(entryPath(baseDir, type, scope, id));
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

async function safeReaddir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

export async function listEntries<T extends HasTypeAndScope>(baseDir: string): Promise<T[]> {
  const results: T[] = [];
  const typeDirs = await safeReaddir(baseDir);
  for (const typeDir of typeDirs) {
    const scopeDirs = await safeReaddir(join(baseDir, typeDir));
    for (const scopeDir of scopeDirs) {
      const files = await safeReaddir(join(baseDir, typeDir, scopeDir));
      for (const file of files) {
        if (!file.endsWith(".json") || file.startsWith("_") || file === "index.json") continue;
        const data = await readJsonObject<T>(join(baseDir, typeDir, scopeDir, file));
        if (data !== undefined) {
          results.push(data);
        }
      }
    }
  }
  return results;
}

export interface IndexableEntry extends HasTypeAndScope {
  projectId: string;
  content: string;
  confidence: TypeIndexEntry["confidence"];
  tags: string[];
  updatedAt: string;
}

function toTypeIndexEntry(data: IndexableEntry): TypeIndexEntry {
  return {
    id: data.id,
    projectId: data.projectId,
    scope: data.scope,
    content: data.content,
    confidence: data.confidence,
    tags: data.tags,
    updatedAt: data.updatedAt,
  };
}

export async function rebuildTypeIndex(baseDir: string, type: MemoryType): Promise<TypeIndex> {
  const typeIndex = emptyTypeIndex(type);
  const typeDir = join(baseDir, type);
  const scopeDirs = await safeReaddir(typeDir);
  for (const scopeDir of scopeDirs) {
    const files = await safeReaddir(join(typeDir, scopeDir));
    for (const file of files) {
      if (!file.endsWith(".json") || file.startsWith("_") || file === "index.json") continue;
      const data = await readJsonObject<IndexableEntry>(join(typeDir, scopeDir, file));
      if (data !== undefined) {
        typeIndex.entries.push(toTypeIndexEntry(data));
      }
    }
  }
  typeIndex.count = typeIndex.entries.length;
  typeIndex.lastUpdated = new Date().toISOString();
  await writeJsonObject(join(typeDir, "_index.json"), typeIndex);
  return typeIndex;
}

export async function rebuildAllIndexes(baseDir: string): Promise<MasterIndex> {
  const master = emptyMasterIndex();
  const typeDirs = await safeReaddir(baseDir);
  for (const typeDir of typeDirs) {
    // Skip files (like index.json) at the base level
    const scopeDirs = await safeReaddir(join(baseDir, typeDir));
    if (scopeDirs.length === 0) {
      // Check if it's actually a directory with content
      continue;
    }
    const typeIndex = await rebuildTypeIndex(baseDir, typeDir as MemoryType);
    if (typeIndex.count === 0) continue;
    master.totalCount += typeIndex.count;
    const scopes = [...new Set(typeIndex.entries.map((e) => e.scope))];
    master.byType[typeDir] = { count: typeIndex.count, scopes };
    for (const scope of scopes) {
      const scopeEntries = typeIndex.entries.filter((e) => e.scope === scope);
      const existing = master.byScope[scope];
      if (existing !== undefined) {
        existing.count += scopeEntries.length;
        if (!existing.types.includes(typeDir)) {
          existing.types.push(typeDir);
        }
      } else {
        master.byScope[scope] = { count: scopeEntries.length, types: [typeDir] };
      }
    }
  }
  master.lastUpdated = new Date().toISOString();
  await writeJsonObject(join(baseDir, "index.json"), master);
  return master;
}

export async function updateIndexesForEntry<T extends IndexableEntry>(
  baseDir: string,
  data: T
): Promise<void> {
  const typeDir = join(baseDir, data.type);
  const indexPath = join(typeDir, "_index.json");
  const existing = await readJsonObject<TypeIndex>(indexPath);
  const typeIndex = existing ?? emptyTypeIndex(data.type);
  const idx = typeIndex.entries.findIndex((e) => e.id === data.id);
  const newEntry = toTypeIndexEntry(data);
  if (idx >= 0) {
    typeIndex.entries[idx] = newEntry;
  } else {
    typeIndex.entries.push(newEntry);
  }
  typeIndex.count = typeIndex.entries.length;
  typeIndex.lastUpdated = new Date().toISOString();
  await writeJsonObject(indexPath, typeIndex);
  await rebuildMasterFromTypeIndexes(baseDir);
}

export async function removeFromIndexes(
  baseDir: string,
  type: MemoryType,
  id: string
): Promise<void> {
  const typeDir = join(baseDir, type);
  const indexPath = join(typeDir, "_index.json");
  const existing = await readJsonObject<TypeIndex>(indexPath);
  if (existing === undefined) return;
  existing.entries = existing.entries.filter((e) => e.id !== id);
  existing.count = existing.entries.length;
  existing.lastUpdated = new Date().toISOString();
  await writeJsonObject(indexPath, existing);
  await rebuildMasterFromTypeIndexes(baseDir);
}

async function rebuildMasterFromTypeIndexes(baseDir: string): Promise<MasterIndex> {
  const master = emptyMasterIndex();
  const typeDirs = await safeReaddir(baseDir);
  for (const typeDir of typeDirs) {
    const indexPath = join(baseDir, typeDir, "_index.json");
    const typeIndex = await readJsonObject<TypeIndex>(indexPath);
    if (typeIndex === undefined || typeIndex.count === 0) continue;
    master.totalCount += typeIndex.count;
    const scopes = [...new Set(typeIndex.entries.map((e) => e.scope))];
    master.byType[typeDir] = { count: typeIndex.count, scopes };
    for (const scope of scopes) {
      const scopeEntries = typeIndex.entries.filter((e) => e.scope === scope);
      const existing = master.byScope[scope];
      if (existing !== undefined) {
        existing.count += scopeEntries.length;
        if (!existing.types.includes(typeDir)) {
          existing.types.push(typeDir);
        }
      } else {
        master.byScope[scope] = { count: scopeEntries.length, types: [typeDir] };
      }
    }
  }
  master.lastUpdated = new Date().toISOString();
  await writeJsonObject(join(baseDir, "index.json"), master);
  return master;
}
