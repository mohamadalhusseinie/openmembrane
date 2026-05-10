import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { OpenMembrainError } from "@openmembrain/core";
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

    const mem1 = await readJsonObject(join(targetDir, "coding_rule", "frontend", "mem_1.json"));
    expect(mem1).toBeDefined();
    const master = await readJsonObject<MasterIndex>(join(targetDir, "index.json"));
    expect(master?.totalCount).toBe(2);
    // Legacy file backed up
    const backup = await readFile(`${legacyPath}.backup`, "utf8");
    expect(JSON.parse(backup)).toHaveLength(2);
  });

  it("does nothing when legacy file does not exist", async () => {
    const dir = await tempDir();
    await migrateMemories(join(dir, "memories.json"), join(dir, "memories"));
  });

  it("does not migrate again when backup already exists", async () => {
    const dir = await tempDir();
    const legacyPath = join(dir, "memories.json");
    const targetDir = join(dir, "memories");
    await writeFile(legacyPath, JSON.stringify([entry({ id: "mem_1" })], null, 2), "utf8");
    await migrateMemories(legacyPath, targetDir);
    await writeFile(legacyPath, JSON.stringify([entry({ id: "mem_999" })], null, 2), "utf8");
    await migrateMemories(legacyPath, targetDir);
    const master = await readJsonObject<MasterIndex>(join(targetDir, "index.json"));
    expect(master?.totalCount).toBe(1);
  });
});

describe("migratePending", () => {
  it("migrates flat pending-candidates.json to directory structure", async () => {
    const dir = await tempDir();
    const legacyPath = join(dir, "pending-candidates.json");
    const targetDir = join(dir, "pending");
    await writeFile(legacyPath, JSON.stringify([candidate({ id: "cand_1" })], null, 2), "utf8");
    await migratePending(legacyPath, targetDir);
    const cand1 = await readJsonObject(join(targetDir, "coding_rule", "frontend", "cand_1.json"));
    expect(cand1).toBeDefined();
  });
});

describe("migration error handling", () => {
  it("throws on invalid JSON in legacy file", async () => {
    const dir = await tempDir();
    const legacyPath = join(dir, "memories.json");
    await writeFile(legacyPath, "not valid json", "utf8");
    await expect(migrateMemories(legacyPath, join(dir, "memories"))).rejects.toThrow(OpenMembrainError);
    try {
      await migrateMemories(legacyPath, join(dir, "memories"));
    } catch (error) {
      expect((error as OpenMembrainError).code).toBe("STORAGE_INVALID_JSON");
    }
  });

  it("throws on non-array JSON in legacy file", async () => {
    const dir = await tempDir();
    const legacyPath = join(dir, "memories.json");
    await writeFile(legacyPath, '{"not": "an array"}', "utf8");
    await expect(migrateMemories(legacyPath, join(dir, "memories"))).rejects.toThrow(OpenMembrainError);
    try {
      await migrateMemories(legacyPath, join(dir, "memories"));
    } catch (error) {
      expect((error as OpenMembrainError).code).toBe("STORAGE_INVALID_JSON");
    }
  });
});
