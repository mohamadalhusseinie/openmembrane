# Directory-Based Structured Memory Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `memories.json` / `pending-candidates.json` files with a hierarchical directory structure organized by type then scope, with index files for fast navigation and querying.

**Architecture:** Storage layer refactor only. The `MemoryStore` and `PendingCandidateStore` interfaces remain unchanged. New low-level I/O helpers (`directoryStore.ts`) handle reading/writing individual JSON files and index files. Migration logic auto-detects the legacy format and converts on first use. Tests are rewritten to validate the new storage backend against identical behavior.

**Tech Stack:** TypeScript (ES2022/ESM), Node.js `fs/promises`, Vitest, existing `@openmembrain/core` types.

---

## File Structure

### New files

| File | Purpose |
|------|---------|
| `packages/storage/src/directoryStore.ts` | Low-level I/O: read/write individual JSON files, read/write index files, rebuild indexes, directory walking |
| `packages/storage/src/indexTypes.ts` | TypeScript types for master index and type-level index structures |
| `packages/storage/src/migrate.ts` | Auto-migration from flat `memories.json` / `pending-candidates.json` to directory layout |
| `tests/unit/directoryStore.test.ts` | Unit tests for low-level directory I/O helpers |
| `tests/unit/migrate.test.ts` | Unit tests for migration logic |

### Modified files

| File | Changes |
|------|---------|
| `packages/storage/src/MemoryStore.ts` | Rewrite to use directory-based storage via `directoryStore.ts` helpers |
| `packages/storage/src/PendingCandidateStore.ts` | Rewrite to use directory-based storage via `directoryStore.ts` helpers |
| `packages/storage/src/jsonFile.ts` | Add `readJsonObject` and `writeJsonObject` helpers for single-object JSON files |
| `packages/storage/src/index.ts` | Add export for `migrate` |
| `tests/unit/MemoryStore.search.test.ts` | No logic changes needed — tests validate behavior through the unchanged interface |
| `tests/unit/MemoryStore.supersede.test.ts` | No logic changes needed — same reason |
| `tests/unit/MemoryApprovalService.test.ts` | No logic changes needed — same reason |
| `tests/memoryPipeline.test.ts` | No logic changes needed — same reason |
| `tests/mcpHandlers.test.ts` | No logic changes needed — same reason |

---

## Task 1: Add single-object JSON I/O helpers to `jsonFile.ts`

**Files:**
- Modify: `packages/storage/src/jsonFile.ts`
- Test: `tests/unit/directoryStore.test.ts`

- [ ] **Step 1: Write the failing tests for `readJsonObject` and `writeJsonObject`**

Create `tests/unit/directoryStore.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readJsonObject, writeJsonObject } from "@openmembrain/storage";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openmembrain-dirstore-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("readJsonObject", () => {
  it("returns undefined when file does not exist", async () => {
    const dir = await tempDir();
    const result = await readJsonObject<{ id: string }>(join(dir, "missing.json"));
    expect(result).toBeUndefined();
  });

  it("reads a valid JSON object", async () => {
    const dir = await tempDir();
    const filePath = join(dir, "test.json");
    await writeJsonObject(filePath, { id: "mem_1", content: "hello" });
    const result = await readJsonObject<{ id: string; content: string }>(filePath);
    expect(result).toEqual({ id: "mem_1", content: "hello" });
  });

  it("throws STORAGE_INVALID_JSON for non-object JSON", async () => {
    const dir = await tempDir();
    const filePath = join(dir, "bad.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, '"just a string"', "utf8");
    await expect(readJsonObject(filePath)).rejects.toThrow("STORAGE_INVALID_JSON");
  });
});

describe("writeJsonObject", () => {
  it("creates parent directories if they do not exist", async () => {
    const dir = await tempDir();
    const filePath = join(dir, "nested", "deep", "file.json");
    await writeJsonObject(filePath, { id: "test" });
    const result = await readJsonObject<{ id: string }>(filePath);
    expect(result).toEqual({ id: "test" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/directoryStore.test.ts`
Expected: FAIL — `readJsonObject` and `writeJsonObject` are not exported.

- [ ] **Step 3: Implement `readJsonObject` and `writeJsonObject` in `jsonFile.ts`**

Add to `packages/storage/src/jsonFile.ts`:

```ts
export async function readJsonObject<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw invalidJsonError(filePath);
    }
    return parsed as T;
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      throw invalidJsonError(filePath, error);
    }
    throw error;
  }
}

export async function writeJsonObject<T>(filePath: string, data: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
```

- [ ] **Step 4: Export the new functions from `packages/storage/src/index.ts`**

Add to `packages/storage/src/index.ts`:

```ts
export { readJsonObject, writeJsonObject } from "./jsonFile";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/directoryStore.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/storage/src/jsonFile.ts packages/storage/src/index.ts tests/unit/directoryStore.test.ts
git commit -m "feat: add single-object JSON I/O helpers (#30)"
```

---

## Task 2: Define index types

**Files:**
- Create: `packages/storage/src/indexTypes.ts`

- [ ] **Step 1: Create the index type definitions**

Create `packages/storage/src/indexTypes.ts`:

```ts
import type { Confidence, MemoryScope, MemoryType } from "@openmembrain/core";

export interface MasterIndex {
  version: number;
  lastUpdated: string;
  totalCount: number;
  byType: Record<string, { count: number; scopes: string[] }>;
  byScope: Record<string, { count: number; types: string[] }>;
}

export interface TypeIndexEntry {
  id: string;
  projectId: string;
  scope: MemoryScope;
  content: string;
  confidence: Confidence;
  tags: string[];
  updatedAt: string;
}

export interface TypeIndex {
  type: MemoryType;
  count: number;
  lastUpdated: string;
  entries: TypeIndexEntry[];
}

export function emptyMasterIndex(): MasterIndex {
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    totalCount: 0,
    byType: {},
    byScope: {},
  };
}

export function emptyTypeIndex(type: MemoryType): TypeIndex {
  return {
    type,
    count: 0,
    lastUpdated: new Date().toISOString(),
    entries: [],
  };
}
```

- [ ] **Step 2: Export from `packages/storage/src/index.ts`**

Add to `packages/storage/src/index.ts`:

```ts
export type { MasterIndex, TypeIndex, TypeIndexEntry } from "./indexTypes";
```

- [ ] **Step 3: Run typecheck to verify**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/storage/src/indexTypes.ts packages/storage/src/index.ts
git commit -m "feat: add index type definitions for directory-based storage (#30)"
```

---

## Task 3: Implement directory store helpers

**Files:**
- Create: `packages/storage/src/directoryStore.ts`
- Test: `tests/unit/directoryStore.test.ts` (append to existing file)

- [ ] **Step 1: Write failing tests for `writeEntry`, `readEntry`, `removeEntry`, and `listEntries`**

Append to `tests/unit/directoryStore.test.ts`:

```ts
import { writeEntry, readEntry, removeEntry, listEntries } from "@openmembrain/storage";
import { entry } from "./helpers";

describe("writeEntry", () => {
  it("writes a memory entry to {type}/{scope}/{id}.json", async () => {
    const dir = await tempDir();
    const mem = entry({ id: "mem_abc", type: "coding_rule", scope: "frontend" });
    await writeEntry(join(dir, "memories"), mem);
    const result = await readEntry(join(dir, "memories"), "coding_rule", "frontend", "mem_abc");
    expect(result).toEqual(mem);
  });
});

describe("readEntry", () => {
  it("returns undefined when entry does not exist", async () => {
    const dir = await tempDir();
    const result = await readEntry(join(dir, "memories"), "coding_rule", "frontend", "mem_missing");
    expect(result).toBeUndefined();
  });
});

describe("removeEntry", () => {
  it("removes an existing entry file", async () => {
    const dir = await tempDir();
    const mem = entry({ id: "mem_abc", type: "coding_rule", scope: "frontend" });
    await writeEntry(join(dir, "memories"), mem);
    await removeEntry(join(dir, "memories"), "coding_rule", "frontend", "mem_abc");
    const result = await readEntry(join(dir, "memories"), "coding_rule", "frontend", "mem_abc");
    expect(result).toBeUndefined();
  });

  it("does not throw when entry does not exist", async () => {
    const dir = await tempDir();
    await expect(removeEntry(join(dir, "memories"), "coding_rule", "frontend", "mem_missing"))
      .resolves.not.toThrow();
  });
});

describe("listEntries", () => {
  it("returns all entries across all type/scope directories", async () => {
    const dir = await tempDir();
    const base = join(dir, "memories");
    const mem1 = entry({ id: "mem_1", type: "coding_rule", scope: "frontend" });
    const mem2 = entry({ id: "mem_2", type: "security_rule", scope: "backend", content: "Different." });
    await writeEntry(base, mem1);
    await writeEntry(base, mem2);
    const entries = await listEntries(base);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id).sort()).toEqual(["mem_1", "mem_2"]);
  });

  it("returns empty array when directory does not exist", async () => {
    const dir = await tempDir();
    const entries = await listEntries(join(dir, "nonexistent"));
    expect(entries).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/directoryStore.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement `directoryStore.ts`**

Create `packages/storage/src/directoryStore.ts`:

```ts
import { join } from "node:path";
import { readdir, rm } from "node:fs/promises";
import type { MemoryEntry, MemoryScope, MemoryType } from "@openmembrain/core";
import { readJsonObject, writeJsonObject } from "./jsonFile";

export interface HasTypeAndScope {
  readonly id: string;
  readonly type: MemoryType;
  readonly scope: MemoryScope;
}

function entryPath(baseDir: string, type: string, scope: string, id: string): string {
  return join(baseDir, type, scope, `${id}.json`);
}

export async function writeEntry<T extends HasTypeAndScope>(baseDir: string, data: T): Promise<void> {
  await writeJsonObject(entryPath(baseDir, data.type, data.scope, data.id), data);
}

export async function readEntry<T>(
  baseDir: string,
  type: string,
  scope: string,
  id: string
): Promise<T | undefined> {
  return readJsonObject<T>(entryPath(baseDir, type, scope, id));
}

export async function removeEntry(
  baseDir: string,
  type: string,
  scope: string,
  id: string
): Promise<void> {
  try {
    await rm(entryPath(baseDir, type, scope, id));
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

export async function listEntries<T extends HasTypeAndScope>(baseDir: string): Promise<T[]> {
  const entries: T[] = [];
  let typeDirs: string[];
  try {
    typeDirs = await readdir(baseDir);
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  for (const typeDir of typeDirs) {
    const typePath = join(baseDir, typeDir);
    let scopeDirs: string[];
    try {
      scopeDirs = await readdir(typePath);
    } catch {
      continue;
    }

    for (const scopeDir of scopeDirs) {
      const scopePath = join(typePath, scopeDir);
      let files: string[];
      try {
        files = await readdir(scopePath);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".json") || file.startsWith("_")) {
          continue;
        }
        const data = await readJsonObject<T>(join(scopePath, file));
        if (data !== undefined) {
          entries.push(data);
        }
      }
    }
  }

  return entries;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
```

- [ ] **Step 4: Export from `packages/storage/src/index.ts`**

Add to `packages/storage/src/index.ts`:

```ts
export { writeEntry, readEntry, removeEntry, listEntries } from "./directoryStore";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/directoryStore.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/storage/src/directoryStore.ts packages/storage/src/index.ts tests/unit/directoryStore.test.ts
git commit -m "feat: add directory store helpers for entry I/O (#30)"
```

---

## Task 4: Implement index generation and rebuild

**Files:**
- Modify: `packages/storage/src/directoryStore.ts`
- Test: `tests/unit/directoryStore.test.ts` (append)

- [ ] **Step 1: Write failing tests for `rebuildMasterIndex`, `rebuildTypeIndex`, and `rebuildAllIndexes`**

Append to `tests/unit/directoryStore.test.ts`:

```ts
import type { MasterIndex, TypeIndex } from "@openmembrain/storage";
import { rebuildMasterIndex, rebuildTypeIndex, rebuildAllIndexes } from "@openmembrain/storage";

describe("rebuildTypeIndex", () => {
  it("generates a type index from entry files", async () => {
    const dir = await tempDir();
    const base = join(dir, "memories");
    await writeEntry(base, entry({ id: "mem_1", type: "coding_rule", scope: "frontend" }));
    await writeEntry(base, entry({
      id: "mem_2",
      type: "coding_rule",
      scope: "backend",
      content: "Backend rule."
    }));

    const index = await rebuildTypeIndex(base, "coding_rule");
    expect(index.type).toBe("coding_rule");
    expect(index.count).toBe(2);
    expect(index.entries).toHaveLength(2);
    expect(index.entries.map((e) => e.id).sort()).toEqual(["mem_1", "mem_2"]);
  });

  it("returns empty index when type directory does not exist", async () => {
    const dir = await tempDir();
    const index = await rebuildTypeIndex(join(dir, "memories"), "coding_rule");
    expect(index.count).toBe(0);
    expect(index.entries).toHaveLength(0);
  });
});

describe("rebuildAllIndexes", () => {
  it("generates master index and all type indexes", async () => {
    const dir = await tempDir();
    const base = join(dir, "memories");
    await writeEntry(base, entry({ id: "mem_1", type: "coding_rule", scope: "frontend" }));
    await writeEntry(base, entry({
      id: "mem_2",
      type: "security_rule",
      scope: "backend",
      content: "Security rule."
    }));

    const master = await rebuildAllIndexes(base);
    expect(master.totalCount).toBe(2);
    expect(master.byType["coding_rule"]?.count).toBe(1);
    expect(master.byType["security_rule"]?.count).toBe(1);
    expect(master.byScope["frontend"]?.count).toBe(1);
    expect(master.byScope["backend"]?.count).toBe(1);

    // Verify type index files were written
    const typeIndex = await readJsonObject<TypeIndex>(join(base, "coding_rule", "_index.json"));
    expect(typeIndex?.count).toBe(1);

    // Verify master index file was written
    const masterFromDisk = await readJsonObject<MasterIndex>(join(base, "index.json"));
    expect(masterFromDisk?.totalCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/directoryStore.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement index generation functions in `directoryStore.ts`**

Add to `packages/storage/src/directoryStore.ts`:

```ts
import { readdir } from "node:fs/promises";
import type { MasterIndex, TypeIndex, TypeIndexEntry } from "./indexTypes";
import { emptyMasterIndex, emptyTypeIndex } from "./indexTypes";
import { nowIso } from "@openmembrain/shared";

function toTypeIndexEntry(entry: HasTypeAndScope & {
  projectId: string;
  content: string;
  confidence: string;
  tags: string[];
  updatedAt: string;
}): TypeIndexEntry {
  return {
    id: entry.id,
    projectId: entry.projectId,
    scope: entry.scope,
    content: entry.content,
    confidence: entry.confidence as TypeIndexEntry["confidence"],
    tags: entry.tags,
    updatedAt: entry.updatedAt,
  };
}

export async function rebuildTypeIndex(baseDir: string, type: string): Promise<TypeIndex> {
  const typePath = join(baseDir, type);
  const index = emptyTypeIndex(type as TypeIndex["type"]);

  let scopeDirs: string[];
  try {
    scopeDirs = await readdir(typePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return index;
    }
    throw error;
  }

  for (const scopeDir of scopeDirs) {
    if (scopeDir.startsWith("_") || scopeDir.endsWith(".json")) {
      continue;
    }
    const scopePath = join(typePath, scopeDir);
    let files: string[];
    try {
      files = await readdir(scopePath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".json") || file.startsWith("_")) {
        continue;
      }
      const data = await readJsonObject<HasTypeAndScope & {
        projectId: string;
        content: string;
        confidence: string;
        tags: string[];
        updatedAt: string;
      }>(join(scopePath, file));
      if (data !== undefined) {
        index.entries.push(toTypeIndexEntry(data));
      }
    }
  }

  index.count = index.entries.length;
  index.lastUpdated = nowIso();
  await writeJsonObject(join(typePath, "_index.json"), index);
  return index;
}

export async function rebuildAllIndexes(baseDir: string): Promise<MasterIndex> {
  const master = emptyMasterIndex();
  let typeDirs: string[];
  try {
    typeDirs = await readdir(baseDir);
  } catch (error) {
    if (isNotFoundError(error)) {
      await writeJsonObject(join(baseDir, "index.json"), master);
      return master;
    }
    throw error;
  }

  for (const typeDir of typeDirs) {
    if (typeDir.endsWith(".json") || typeDir.startsWith("_")) {
      continue;
    }
    const typeIndex = await rebuildTypeIndex(baseDir, typeDir);
    if (typeIndex.count === 0) {
      continue;
    }

    const scopes = [...new Set(typeIndex.entries.map((e) => e.scope))];
    master.byType[typeDir] = { count: typeIndex.count, scopes };

    for (const entry of typeIndex.entries) {
      const existing = master.byScope[entry.scope];
      if (existing !== undefined) {
        existing.count += 1;
        if (!existing.types.includes(typeDir)) {
          existing.types.push(typeDir);
        }
      } else {
        master.byScope[entry.scope] = { count: 1, types: [typeDir] };
      }
    }

    master.totalCount += typeIndex.count;
  }

  master.lastUpdated = nowIso();
  await writeJsonObject(join(baseDir, "index.json"), master);
  return master;
}
```

- [ ] **Step 4: Export new functions from `packages/storage/src/index.ts`**

Add:

```ts
export { rebuildTypeIndex, rebuildAllIndexes } from "./directoryStore";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/directoryStore.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/storage/src/directoryStore.ts packages/storage/src/index.ts tests/unit/directoryStore.test.ts
git commit -m "feat: add index generation and rebuild logic (#30)"
```

---

## Task 5: Implement `updateIndexesForEntry` (write-through index updates)

**Files:**
- Modify: `packages/storage/src/directoryStore.ts`
- Test: `tests/unit/directoryStore.test.ts` (append)

- [ ] **Step 1: Write failing test for `updateIndexesForEntry`**

Append to `tests/unit/directoryStore.test.ts`:

```ts
import { updateIndexesForEntry } from "@openmembrain/storage";

describe("updateIndexesForEntry", () => {
  it("updates type index and master index when an entry is saved", async () => {
    const dir = await tempDir();
    const base = join(dir, "memories");
    const mem = entry({ id: "mem_1", type: "coding_rule", scope: "frontend" });
    await writeEntry(base, mem);
    await updateIndexesForEntry(base, mem);

    const typeIndex = await readJsonObject<TypeIndex>(join(base, "coding_rule", "_index.json"));
    expect(typeIndex?.count).toBe(1);
    expect(typeIndex?.entries[0]?.id).toBe("mem_1");

    const master = await readJsonObject<MasterIndex>(join(base, "index.json"));
    expect(master?.totalCount).toBe(1);
  });

  it("updates existing entry in indexes without duplicating", async () => {
    const dir = await tempDir();
    const base = join(dir, "memories");
    const mem = entry({ id: "mem_1", type: "coding_rule", scope: "frontend" });
    await writeEntry(base, mem);
    await updateIndexesForEntry(base, mem);
    const updated = { ...mem, content: "Updated content." };
    await writeEntry(base, updated);
    await updateIndexesForEntry(base, updated);

    const typeIndex = await readJsonObject<TypeIndex>(join(base, "coding_rule", "_index.json"));
    expect(typeIndex?.count).toBe(1);
    expect(typeIndex?.entries[0]?.content).toBe("Updated content.");

    const master = await readJsonObject<MasterIndex>(join(base, "index.json"));
    expect(master?.totalCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/directoryStore.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `updateIndexesForEntry`**

Add to `packages/storage/src/directoryStore.ts`:

```ts
export async function updateIndexesForEntry(
  baseDir: string,
  data: HasTypeAndScope & {
    projectId: string;
    content: string;
    confidence: string;
    tags: string[];
    updatedAt: string;
  }
): Promise<void> {
  // Update type-level index
  const typePath = join(baseDir, data.type);
  const typeIndexPath = join(typePath, "_index.json");
  const typeIndex = (await readJsonObject<TypeIndex>(typeIndexPath)) ?? emptyTypeIndex(data.type as TypeIndex["type"]);

  const existingIdx = typeIndex.entries.findIndex((e) => e.id === data.id);
  const newEntry = toTypeIndexEntry(data);
  if (existingIdx >= 0) {
    typeIndex.entries[existingIdx] = newEntry;
  } else {
    typeIndex.entries.push(newEntry);
  }
  typeIndex.count = typeIndex.entries.length;
  typeIndex.lastUpdated = nowIso();
  await writeJsonObject(typeIndexPath, typeIndex);

  // Rebuild master from all type indexes
  await rebuildMasterFromTypeIndexes(baseDir);
}

async function rebuildMasterFromTypeIndexes(baseDir: string): Promise<void> {
  const master = emptyMasterIndex();
  let typeDirs: string[];
  try {
    typeDirs = await readdir(baseDir);
  } catch (error) {
    if (isNotFoundError(error)) {
      await writeJsonObject(join(baseDir, "index.json"), master);
      return;
    }
    throw error;
  }

  for (const typeDir of typeDirs) {
    if (typeDir.endsWith(".json") || typeDir.startsWith("_")) {
      continue;
    }
    const typeIndex = await readJsonObject<TypeIndex>(join(baseDir, typeDir, "_index.json"));
    if (typeIndex === undefined || typeIndex.count === 0) {
      continue;
    }

    const scopes = [...new Set(typeIndex.entries.map((e) => e.scope))];
    master.byType[typeDir] = { count: typeIndex.count, scopes };

    for (const e of typeIndex.entries) {
      const existing = master.byScope[e.scope];
      if (existing !== undefined) {
        existing.count += 1;
        if (!existing.types.includes(typeDir)) {
          existing.types.push(typeDir);
        }
      } else {
        master.byScope[e.scope] = { count: 1, types: [typeDir] };
      }
    }

    master.totalCount += typeIndex.count;
  }

  master.lastUpdated = nowIso();
  await writeJsonObject(join(baseDir, "index.json"), master);
}
```

- [ ] **Step 4: Export and run tests**

Export `updateIndexesForEntry` from `packages/storage/src/index.ts`.

Run: `npx vitest run tests/unit/directoryStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/directoryStore.ts packages/storage/src/index.ts tests/unit/directoryStore.test.ts
git commit -m "feat: add write-through index updates (#30)"
```

---

## Task 6: Implement `removeFromIndexes`

**Files:**
- Modify: `packages/storage/src/directoryStore.ts`
- Test: `tests/unit/directoryStore.test.ts` (append)

- [ ] **Step 1: Write failing test**

Append to `tests/unit/directoryStore.test.ts`:

```ts
import { removeFromIndexes } from "@openmembrain/storage";

describe("removeFromIndexes", () => {
  it("removes entry from type index and updates master index", async () => {
    const dir = await tempDir();
    const base = join(dir, "memories");
    const mem1 = entry({ id: "mem_1", type: "coding_rule", scope: "frontend" });
    const mem2 = entry({ id: "mem_2", type: "coding_rule", scope: "backend", content: "Other." });
    await writeEntry(base, mem1);
    await writeEntry(base, mem2);
    await updateIndexesForEntry(base, mem1);
    await updateIndexesForEntry(base, mem2);

    await removeFromIndexes(base, "coding_rule", "mem_1");

    const typeIndex = await readJsonObject<TypeIndex>(join(base, "coding_rule", "_index.json"));
    expect(typeIndex?.count).toBe(1);
    expect(typeIndex?.entries[0]?.id).toBe("mem_2");

    const master = await readJsonObject<MasterIndex>(join(base, "index.json"));
    expect(master?.totalCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/directoryStore.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `removeFromIndexes`**

Add to `packages/storage/src/directoryStore.ts`:

```ts
export async function removeFromIndexes(
  baseDir: string,
  type: string,
  id: string
): Promise<void> {
  const typeIndexPath = join(baseDir, type, "_index.json");
  const typeIndex = await readJsonObject<TypeIndex>(typeIndexPath);
  if (typeIndex !== undefined) {
    typeIndex.entries = typeIndex.entries.filter((e) => e.id !== id);
    typeIndex.count = typeIndex.entries.length;
    typeIndex.lastUpdated = nowIso();
    await writeJsonObject(typeIndexPath, typeIndex);
  }

  await rebuildMasterFromTypeIndexes(baseDir);
}
```

- [ ] **Step 4: Export and run tests**

Export `removeFromIndexes` from `packages/storage/src/index.ts`.

Run: `npx vitest run tests/unit/directoryStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/directoryStore.ts packages/storage/src/index.ts tests/unit/directoryStore.test.ts
git commit -m "feat: add removeFromIndexes for directory store (#30)"
```

---

## Task 7: Rewrite `JsonMemoryStore` to use directory-based storage

**Files:**
- Modify: `packages/storage/src/MemoryStore.ts`

- [ ] **Step 1: Rewrite `JsonMemoryStore`**

Replace the contents of `packages/storage/src/MemoryStore.ts`:

```ts
import { join } from "node:path";
import type { MemoryEntry, MemorySearchOptions, MemoryStore } from "@openmembrain/core";
import { OpenMembrainError } from "@openmembrain/core";
import { nowIso } from "@openmembrain/shared";
import type { TypeIndex } from "./indexTypes";
import { readJsonObject } from "./jsonFile";
import {
  listEntries,
  readEntry,
  rebuildAllIndexes,
  removeEntry,
  removeFromIndexes,
  updateIndexesForEntry,
  writeEntry,
} from "./directoryStore";
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
    // Search type indexes to find the entry location
    const { readdir } = await import("node:fs/promises");
    let typeDirs: string[];
    try {
      typeDirs = await readdir(this.baseDir);
    } catch {
      return undefined;
    }

    for (const typeDir of typeDirs) {
      if (typeDir.endsWith(".json") || typeDir.startsWith("_")) {
        continue;
      }
      const typeIndex = await readJsonObject<TypeIndex>(join(this.baseDir, typeDir, "_index.json"));
      if (typeIndex === undefined) {
        continue;
      }
      const match = typeIndex.entries.find((e) => e.id === memoryId && e.projectId === projectId);
      if (match !== undefined) {
        return readEntry<MemoryEntry>(this.baseDir, typeDir, match.scope, memoryId);
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
```

- [ ] **Step 2: Run existing memory store tests to check for regressions**

Run: `npx vitest run tests/unit/MemoryStore.search.test.ts tests/unit/MemoryStore.supersede.test.ts`
Expected: Some may fail until migration is implemented (Task 9). Note which tests fail.

- [ ] **Step 3: Commit**

```bash
git add packages/storage/src/MemoryStore.ts
git commit -m "refactor: rewrite JsonMemoryStore to use directory-based storage (#30)"
```

---

## Task 8: Rewrite `JsonPendingCandidateStore` to use directory-based storage

**Files:**
- Modify: `packages/storage/src/PendingCandidateStore.ts`

- [ ] **Step 1: Rewrite `JsonPendingCandidateStore`**

Replace the contents of `packages/storage/src/PendingCandidateStore.ts`:

```ts
import { join } from "node:path";
import type { MemoryCandidate, PendingCandidateStore } from "@openmembrain/core";
import type { TypeIndex } from "./indexTypes";
import { readJsonObject } from "./jsonFile";
import {
  listEntries,
  readEntry,
  removeEntry,
  removeFromIndexes,
  updateIndexesForEntry,
  writeEntry,
} from "./directoryStore";
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
    const { readdir } = await import("node:fs/promises");
    let typeDirs: string[];
    try {
      typeDirs = await readdir(this.baseDir);
    } catch {
      return undefined;
    }

    for (const typeDir of typeDirs) {
      if (typeDir.endsWith(".json") || typeDir.startsWith("_")) {
        continue;
      }
      const typeIndex = await readJsonObject<TypeIndex>(join(this.baseDir, typeDir, "_index.json"));
      if (typeIndex === undefined) {
        continue;
      }
      const match = typeIndex.entries.find((e) => e.id === candidateId && e.projectId === projectId);
      if (match !== undefined) {
        return readEntry<MemoryCandidate>(this.baseDir, typeDir, match.scope, candidateId);
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
    if (found === undefined) {
      return;
    }
    await removeEntry(this.baseDir, found.type, found.scope, candidateId);
    await removeFromIndexes(this.baseDir, found.type, candidateId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/storage/src/PendingCandidateStore.ts
git commit -m "refactor: rewrite JsonPendingCandidateStore to use directory-based storage (#30)"
```

---

## Task 9: Implement migration from flat format

**Files:**
- Create: `packages/storage/src/migrate.ts`
- Test: `tests/unit/migrate.test.ts`

- [ ] **Step 1: Write failing tests for migration**

Create `tests/unit/migrate.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { migrateMemories, migratePending, readJsonObject } from "@openmembrain/storage";
import type { MasterIndex } from "@openmembrain/storage";
import { entry, candidate } from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openmembrain-migrate-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("migrateMemories", () => {
  it("migrates flat memories.json to directory structure", async () => {
    const dir = await tempDir();
    const legacyPath = join(dir, "memories.json");
    const targetDir = join(dir, "memories");

    const entries = [
      entry({ id: "mem_1", type: "coding_rule", scope: "frontend" }),
      entry({ id: "mem_2", type: "security_rule", scope: "backend", content: "Security rule." }),
    ];
    await writeFile(legacyPath, JSON.stringify(entries, null, 2), "utf8");

    await migrateMemories(legacyPath, targetDir);

    // Individual files exist
    const mem1 = await readJsonObject<typeof entries[0]>(
      join(targetDir, "coding_rule", "frontend", "mem_1.json")
    );
    expect(mem1?.id).toBe("mem_1");

    const mem2 = await readJsonObject<typeof entries[1]>(
      join(targetDir, "security_rule", "backend", "mem_2.json")
    );
    expect(mem2?.id).toBe("mem_2");

    // Master index exists
    const master = await readJsonObject<MasterIndex>(join(targetDir, "index.json"));
    expect(master?.totalCount).toBe(2);

    // Legacy file renamed to backup
    await expect(readFile(legacyPath, "utf8")).rejects.toThrow();
    const backup = await readFile(`${legacyPath}.backup`, "utf8");
    expect(JSON.parse(backup)).toHaveLength(2);
  });

  it("does nothing when legacy file does not exist", async () => {
    const dir = await tempDir();
    await migrateMemories(join(dir, "memories.json"), join(dir, "memories"));
    // No errors, no files created
  });

  it("does not migrate again when backup already exists", async () => {
    const dir = await tempDir();
    const legacyPath = join(dir, "memories.json");
    const targetDir = join(dir, "memories");

    const entries = [entry({ id: "mem_1" })];
    await writeFile(legacyPath, JSON.stringify(entries, null, 2), "utf8");
    await migrateMemories(legacyPath, targetDir);

    // Write a new memories.json (shouldn't be migrated since backup exists)
    await writeFile(legacyPath, JSON.stringify([entry({ id: "mem_999" })], null, 2), "utf8");
    await migrateMemories(legacyPath, targetDir);

    const master = await readJsonObject<MasterIndex>(join(targetDir, "index.json"));
    expect(master?.totalCount).toBe(1); // Still 1, not 2
  });
});

describe("migratePending", () => {
  it("migrates flat pending-candidates.json to directory structure", async () => {
    const dir = await tempDir();
    const legacyPath = join(dir, "pending-candidates.json");
    const targetDir = join(dir, "pending");

    const candidates = [candidate({ id: "cand_1", type: "coding_rule", scope: "frontend" })];
    await writeFile(legacyPath, JSON.stringify(candidates, null, 2), "utf8");

    await migratePending(legacyPath, targetDir);

    const cand1 = await readJsonObject<typeof candidates[0]>(
      join(targetDir, "coding_rule", "frontend", "cand_1.json")
    );
    expect(cand1?.id).toBe("cand_1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/migrate.test.ts`
Expected: FAIL — `migrateMemories` and `migratePending` not found.

- [ ] **Step 3: Implement `migrate.ts`**

Create `packages/storage/src/migrate.ts`:

```ts
import { readFile, rename, stat } from "node:fs/promises";
import type { MemoryCandidate, MemoryEntry } from "@openmembrain/core";
import { writeEntry, rebuildAllIndexes } from "./directoryStore";

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function migrateMemories(legacyPath: string, targetDir: string): Promise<void> {
  await migrateFlat<MemoryEntry>(legacyPath, targetDir);
}

export async function migratePending(legacyPath: string, targetDir: string): Promise<void> {
  await migrateFlat<MemoryCandidate>(legacyPath, targetDir);
}

async function migrateFlat<T extends { id: string; type: string; scope: string }>(
  legacyPath: string,
  targetDir: string
): Promise<void> {
  const backupPath = `${legacyPath}.backup`;

  // Skip if backup already exists (already migrated) or legacy doesn't exist
  if (await fileExists(backupPath)) {
    return;
  }
  if (!(await fileExists(legacyPath))) {
    return;
  }

  const raw = await readFile(legacyPath, "utf8");
  let entries: T[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return;
    }
    entries = parsed as T[];
  } catch {
    return;
  }

  for (const entry of entries) {
    await writeEntry(targetDir, entry as T & { id: string; type: string; scope: string });
  }

  await rebuildAllIndexes(targetDir);
  await rename(legacyPath, backupPath);
}
```

- [ ] **Step 4: Export from `packages/storage/src/index.ts`**

Add:

```ts
export { migrateMemories, migratePending } from "./migrate";
```

- [ ] **Step 5: Run migration tests**

Run: `npx vitest run tests/unit/migrate.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/storage/src/migrate.ts packages/storage/src/index.ts tests/unit/migrate.test.ts
git commit -m "feat: add automatic migration from flat JSON to directory storage (#30)"
```

---

## Task 10: Run full test suite and fix any regressions

**Files:**
- May need minor adjustments to any test or source file.

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors. If there are errors, fix them.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: All tests pass. If any fail, diagnose and fix.

- [ ] **Step 3: Verify the existing tests still pass with the new storage backend**

Key test files to check:
- `tests/unit/MemoryStore.search.test.ts` — search behavior unchanged
- `tests/unit/MemoryStore.supersede.test.ts` — supersede behavior unchanged
- `tests/unit/MemoryApprovalService.test.ts` — approval flow unchanged
- `tests/memoryPipeline.test.ts` — pipeline integration unchanged
- `tests/mcpHandlers.test.ts` — MCP handlers unchanged

If any tests fail due to file path changes (e.g. `findById` now expects indexes to exist), the issue is likely that tests create stores, save entries, but the migration check runs first. Since tests start with empty dirs and no legacy file, migration should be a no-op and everything should work.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test regressions from directory-based storage refactor (#30)"
```

- [ ] **Step 5: Run `npm run check` for final verification**

Run: `npm run check`
Expected: All typechecks and tests pass.

---

## Task 11: Clean up and finalize

- [ ] **Step 1: Remove `readJsonArray` / `writeJsonArray` if no longer used**

Check if `readJsonArray` and `writeJsonArray` in `jsonFile.ts` are still imported anywhere. If they are only used by `AuditLogStore` and `DiagnosticsLogStore` (which are unchanged), keep them. Otherwise clean up unused exports.

- [ ] **Step 2: Run final full verification**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: clean up unused code after directory storage refactor (#30)"
```
