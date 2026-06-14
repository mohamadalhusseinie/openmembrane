import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { OpenMembraneError } from "@openmembrane/core";
import type { MemoryEntry } from "@openmembrane/core";
import {
  readJsonObject,
  writeJsonObject,
  writeEntry,
  readEntry,
  removeEntry,
  listEntries,
  rebuildTypeIndex,
  rebuildAllIndexes,
  updateIndexesForEntry,
  removeFromIndexes,
} from "@openmembrane/storage";
import { entry } from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openmembrane-dirstore-test-"));
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
    await writeFile(filePath, '"just a string"', "utf8");
    await expect(readJsonObject(filePath)).rejects.toThrow(OpenMembraneError);
    try {
      await readJsonObject(filePath);
    } catch (error) {
      expect((error as OpenMembraneError).code).toBe("STORAGE_INVALID_JSON");
    }
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

describe("writeEntry / readEntry", () => {
  it("writes and reads an entry by type/scope/id path", async () => {
    const dir = await tempDir();
    const e = entry();
    await writeEntry(dir, e);
    const result = await readEntry<MemoryEntry>(dir, e.type, e.scope, e.id);
    expect(result).toEqual(e);
  });

  it("returns undefined for missing entry", async () => {
    const dir = await tempDir();
    const result = await readEntry<MemoryEntry>(dir, "coding_rule", "frontend", "missing");
    expect(result).toBeUndefined();
  });
});

describe("removeEntry", () => {
  it("removes an existing entry", async () => {
    const dir = await tempDir();
    const e = entry();
    await writeEntry(dir, e);
    await removeEntry(dir, e.type, e.scope, e.id);
    const result = await readEntry<MemoryEntry>(dir, e.type, e.scope, e.id);
    expect(result).toBeUndefined();
  });

  it("does not throw for missing entry", async () => {
    const dir = await tempDir();
    await expect(removeEntry(dir, "coding_rule", "frontend", "missing")).resolves.toBeUndefined();
  });
});

describe("listEntries", () => {
  it("lists all entries across types and scopes", async () => {
    const dir = await tempDir();
    const e1 = entry({ id: "mem_1", type: "coding_rule", scope: "frontend" });
    const e2 = entry({ id: "mem_2", type: "project_fact", scope: "backend" });
    await writeEntry(dir, e1);
    await writeEntry(dir, e2);
    const results = await listEntries<MemoryEntry>(dir);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(["mem_1", "mem_2"]);
  });

  it("returns empty array for missing directory", async () => {
    const dir = await tempDir();
    const results = await listEntries<MemoryEntry>(join(dir, "nonexistent"));
    expect(results).toEqual([]);
  });

  it("skips _index.json and index.json files", async () => {
    const dir = await tempDir();
    const e = entry();
    await writeEntry(dir, e);
    await writeJsonObject(join(dir, e.type, e.scope, "_index.json"), { skip: true });
    await writeJsonObject(join(dir, e.type, e.scope, "index.json"), { skip: true });
    const results = await listEntries<MemoryEntry>(dir);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(e.id);
  });
});

describe("rebuildTypeIndex", () => {
  it("generates _index.json for a type directory", async () => {
    const dir = await tempDir();
    const e1 = entry({ id: "mem_1", scope: "frontend" });
    const e2 = entry({ id: "mem_2", scope: "backend" });
    await writeEntry(dir, e1);
    await writeEntry(dir, e2);
    const typeIndex = await rebuildTypeIndex(dir, "coding_rule");
    expect(typeIndex.type).toBe("coding_rule");
    expect(typeIndex.count).toBe(2);
    expect(typeIndex.entries).toHaveLength(2);
    const ids = typeIndex.entries.map((e) => e.id).sort();
    expect(ids).toEqual(["mem_1", "mem_2"]);
  });

  it("handles missing type directory", async () => {
    const dir = await tempDir();
    const typeIndex = await rebuildTypeIndex(dir, "coding_rule");
    expect(typeIndex.count).toBe(0);
    expect(typeIndex.entries).toEqual([]);
  });
});

describe("rebuildAllIndexes", () => {
  it("generates master index.json with byType and byScope", async () => {
    const dir = await tempDir();
    const e1 = entry({ id: "mem_1", type: "coding_rule", scope: "frontend" });
    const e2 = entry({ id: "mem_2", type: "project_fact", scope: "backend" });
    await writeEntry(dir, e1);
    await writeEntry(dir, e2);
    const master = await rebuildAllIndexes(dir);
    expect(master.totalCount).toBe(2);
    expect(master.byType["coding_rule"]!.count).toBe(1);
    expect(master.byType["project_fact"]!.count).toBe(1);
    expect(master.byScope["frontend"]!.count).toBe(1);
    expect(master.byScope["backend"]!.count).toBe(1);
  });

  it("handles empty directory", async () => {
    const dir = await tempDir();
    const master = await rebuildAllIndexes(dir);
    expect(master.totalCount).toBe(0);
  });
});

describe("updateIndexesForEntry", () => {
  it("creates indexes when entry is saved", async () => {
    const dir = await tempDir();
    const e = entry();
    await writeEntry(dir, e);
    await updateIndexesForEntry(dir, e);
    const master = await readJsonObject<{ totalCount: number }>(join(dir, "index.json"));
    expect(master!.totalCount).toBe(1);
  });

  it("updates existing entry without creating duplicates", async () => {
    const dir = await tempDir();
    const e = entry();
    await writeEntry(dir, e);
    await updateIndexesForEntry(dir, e);
    await updateIndexesForEntry(dir, { ...e, content: "updated" });
    const typeIndex = await readJsonObject<{ count: number }>(join(dir, e.type, "_index.json"));
    expect(typeIndex!.count).toBe(1);
  });

  it("does not crash when index.json already exists in baseDir", async () => {
    const dir = await tempDir();
    const e1 = entry({ id: "mem_1" });
    await writeEntry(dir, e1);
    await updateIndexesForEntry(dir, e1);
    // Second entry triggers rebuildMasterFromTypeIndexes with index.json present
    const e2 = entry({ id: "mem_2" });
    await writeEntry(dir, e2);
    await updateIndexesForEntry(dir, e2);
    const master = await readJsonObject<{ totalCount: number }>(join(dir, "index.json"));
    expect(master!.totalCount).toBe(2);
  });
});

describe("removeFromIndexes", () => {
  it("removes entry from indexes", async () => {
    const dir = await tempDir();
    const e = entry();
    await writeEntry(dir, e);
    await updateIndexesForEntry(dir, e);
    await removeFromIndexes(dir, e.type, e.id);
    const typeIndex = await readJsonObject<{ count: number; entries: unknown[] }>(join(dir, e.type, "_index.json"));
    expect(typeIndex!.count).toBe(0);
    expect(typeIndex!.entries).toEqual([]);
    const master = await readJsonObject<{ totalCount: number }>(join(dir, "index.json"));
    expect(master!.totalCount).toBe(0);
  });
});
