import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const script = resolve("scripts", "check-storage-imports.mjs");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "om-imports-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

describe("storage import CI enforcement", () => {
  it("allows storage owners, tests, unrelated imports, and non-import strings", async () => {
    const root = await fixture({
      "packages/service/src/store.ts": 'import { createStores } from "@openmembrane/storage";',
      "packages/storage/src/factory.ts": 'export * from "./json";',
      "apps/daemon/src/storage.ts": 'import type { StoreSet } from "@openmembrane/storage";',
      "tests/test.ts": 'const storage = await import("@openmembrane/storage");',
      "apps/review-ui/src/context.ts": 'import { OpenMembraneClient } from "@openmembrane/client";',
      "vitest.config.ts": 'const aliases = { "@openmembrane/storage": "./packages/storage/src/index.ts" };',
      "node_modules/ignored/file.ts": 'import "@openmembrane/storage";',
      "apps/mcp-server/dist/index.js": 'import "@openmembrane/storage";',
    });
    expect((await exec(process.execPath, [script], { cwd: root })).stdout).toContain("passed");
  });

  it("rejects static, type, dynamic, require, export and relative storage imports", async () => {
    const root = await fixture({
      "apps/review-ui/src/context.ts": 'import { createStores } from "@openmembrane/storage";',
      "packages/core/src/types.ts": 'type Stores = import("@openmembrane/storage").StoreSet;',
      "apps/mcp-server/src/index.ts": 'const storage = await import("@openmembrane/storage");',
      "scripts/store.cjs": 'const storage = require("@openmembrane/storage/src/index");',
      "packages/shared/src/index.ts": 'export * from "@openmembrane/storage";',
      "packages/core/src/relative.ts": 'import { createStores } from "../../storage/src/index";',
    });
    const result: unknown = await exec(process.execPath, [script], { cwd: root }).catch((error: unknown) => error);
    for (const path of [
      "apps/review-ui/src/context.ts", "packages/core/src/types.ts", "apps/mcp-server/src/index.ts",
      "scripts/store.cjs", "packages/shared/src/index.ts", "packages/core/src/relative.ts",
    ]) expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining(`${path}:1`) });
  });
});
