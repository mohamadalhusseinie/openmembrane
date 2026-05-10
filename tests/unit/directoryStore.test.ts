import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { OpenMembrainError } from "@openmembrain/core";
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
    await writeFile(filePath, '"just a string"', "utf8");
    await expect(readJsonObject(filePath)).rejects.toThrow(OpenMembrainError);
    try {
      await readJsonObject(filePath);
    } catch (error) {
      expect((error as OpenMembrainError).code).toBe("STORAGE_INVALID_JSON");
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
