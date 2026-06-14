import { describe, it, expect, afterEach } from "vitest";
import { createStores } from "@openmembrane/storage";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlinkSync, mkdirSync, rmSync, existsSync } from "node:fs";

function tmpDir(): string {
  const dir = join(tmpdir(), `openmembrane-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("createStores", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    cleanupDirs.length = 0;
  });

  it("returns JSON stores by default", async () => {
    const dir = tmpDir();
    cleanupDirs.push(dir);
    const stores = await createStores({ backend: "json", baseDir: dir });
    expect(stores.memoryStore).toBeDefined();
    expect(stores.pendingCandidateStore).toBeDefined();
    expect(stores.auditLogStore).toBeDefined();
    expect(stores.diagnosticsLogStore).toBeDefined();
    expect(stores.close).toBeUndefined();
  });

  it("returns SQLite stores when backend is sqlite", async () => {
    const dir = tmpDir();
    cleanupDirs.push(dir);
    const stores = await createStores({ backend: "sqlite", baseDir: dir });
    expect(stores.memoryStore).toBeDefined();
    expect(stores.pendingCandidateStore).toBeDefined();
    expect(stores.auditLogStore).toBeDefined();
    expect(stores.diagnosticsLogStore).toBeDefined();
    expect(stores.close).toBeDefined();
    stores.close!();
  });

  it("SQLite stores share a database file", async () => {
    const dir = tmpDir();
    cleanupDirs.push(dir);
    const stores = await createStores({ backend: "sqlite", baseDir: dir });
    expect(existsSync(join(dir, "openmembrane.db"))).toBe(true);
    stores.close!();
  });
});
