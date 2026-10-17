import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenMembraneService, resolveProjectRef } from "@openmembrane/service";
import { entry } from "../helpers";

const directories: string[] = [];
const services: ReturnType<typeof createOpenMembraneService>[] = [];

async function tempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmembrane-service-"));
  directories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(services.map((service) => service.close()));
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  services.length = 0;
  directories.length = 0;
});

describe("OpenMembraneService", () => {
  it.each(["json", "sqlite"] as const)("keeps review search active-only before limiting on %s", async (storageBackend) => {
    const root = await tempDir();
    const service = createOpenMembraneService();
    services.push(service);
    const ref = { projectRoot: root, projectId: "search-project", storageBackend };
    const project = await service.forProject(ref);
    const state = await service.projectState(ref);
    const active = entry({ projectId: ref.projectId, id: "active", content: "Search sentinel rule.", updatedAt: "2025-01-01" });
    const superseded = entry({ projectId: ref.projectId, id: "obsolete", content: "Search sentinel rule.", status: "superseded", updatedAt: "2026-01-01" });
    await state.memoryStore.save(active);
    await state.memoryStore.save(superseded);
    expect((await project.listMemories({ query: "sentinel" })).map(memory => memory.id)).toEqual(["active"]);
    expect((await project.listMemories({ query: "sentinel", limit: 1 })).map(memory => memory.id)).toEqual(["active"]);
    vi.spyOn(state.memoryStore, "search").mockResolvedValue([superseded, active]);
    expect((await project.listMemories({ query: "sentinel", limit: 1 })).map(memory => memory.id)).toEqual(["active"]);
  });

  it("defers invalid extractor configuration for review without masking extraction errors", async () => {
    const root = await tempDir();
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "anthropic");
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_ENABLED", "true");
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_API_KEY", undefined);
    const ref = { projectRoot: root, projectId: "review-project" };

    const eager = createOpenMembraneService();
    services.push(eager);
    await expect(eager.forProject(ref)).rejects.toThrow("requires an apiKey");

    const deferred = createOpenMembraneService({ deferExtractionInitialization: true });
    services.push(deferred);
    const project = await deferred.forProject(ref);
    await project.remember({ content: "Review existing project knowledge", type: "testing_rule", confidence: "high" });
    expect((await project.listMemories()).map((memory) => memory.content)).toContain("Review existing project knowledge");
    expect(await project.listCandidates()).toEqual([]);
    expect(await (await deferred.projectState(ref)).diagnosticsLogStore.list(ref.projectId)).toEqual([]);
    await expect(project.proposeMemoryFromSession({ summary: "testing_rule: Review existing project knowledge." }))
      .rejects.toThrow("requires an apiKey");
  });

  it("uses the project root and environment overrides with explicit reference precedence", async () => {
    const root = await tempDir();
    const envStorage = await tempDir();
    const explicitStorage = await tempDir();
    const previousHome = process.env.OPENMEMBRANE_HOME;
    const previousId = process.env.OPENMEMBRANE_PROJECT_ID;
    try {
      delete process.env.OPENMEMBRANE_HOME;
      delete process.env.OPENMEMBRANE_PROJECT_ID;
      expect(resolveProjectRef({ projectRoot: root })).toEqual({
        projectRoot: root,
        storageDir: join(root, ".openmembrane"),
        projectId: basename(root),
      });
      process.env.OPENMEMBRANE_HOME = envStorage;
      process.env.OPENMEMBRANE_PROJECT_ID = "environment-project";
      expect(resolveProjectRef({ projectRoot: root })).toMatchObject({
        storageDir: envStorage,
        projectId: "environment-project",
      });
      expect(resolveProjectRef({ projectRoot: root, projectId: "explicit", storageDir: explicitStorage })).toMatchObject({
        storageDir: explicitStorage,
        projectId: "explicit",
      });
    } finally {
      if (previousHome === undefined) delete process.env.OPENMEMBRANE_HOME;
      else process.env.OPENMEMBRANE_HOME = previousHome;
      if (previousId === undefined) delete process.env.OPENMEMBRANE_PROJECT_ID;
      else process.env.OPENMEMBRANE_PROJECT_ID = previousId;
    }
  });

  it("isolates projects sharing a storage directory and reuses their scoped instances", async () => {
    const root = await tempDir();
    const service = createOpenMembraneService();
    services.push(service);
    const alphaRef = { projectRoot: root, projectId: "alpha" };
    const betaRef = { projectRoot: root, projectId: "beta" };
    const alpha = await service.forProject(alphaRef);
    const beta = await service.forProject(betaRef);
    expect(await service.forProject(alphaRef)).toBe(alpha);
    expect(await service.projectState(alphaRef)).toBe(await service.projectState(alphaRef));
    expect((await service.projectState(alphaRef)).memoryStore).toBe((await service.projectState(betaRef)).memoryStore);

    await alpha.remember({ content: "Use alpha's custom fixture for tests", type: "testing_rule", confidence: "high" });
    expect((await alpha.searchMemory({ query: "alpha" })).length).toBeGreaterThan(0);
    expect((await alpha.searchMemory({ query: "alpha", projectId: "beta" })).length).toBeGreaterThan(0);
    expect(await beta.searchMemory({ query: "alpha" })).toEqual([]);
    await service.close();
    await expect(service.forProject(alphaRef)).rejects.toThrow("closed");
  });

  it("uses separate stores for separate storage directories", async () => {
    const root = await tempDir();
    const other = await tempDir();
    const service = createOpenMembraneService();
    services.push(service);
    const first = await service.forProject({ projectRoot: root, projectId: "same", storageDir: root });
    const second = await service.forProject({ projectRoot: root, projectId: "same", storageDir: other });
    await first.remember({ content: "Store alpha knowledge for future tests", type: "testing_rule", confidence: "high" });
    expect((await first.searchMemory({ query: "alpha" })).length).toBeGreaterThan(0);
    expect(await second.searchMemory({ query: "alpha" })).toEqual([]);
  });

  it("caches json and sqlite separately for the same storage directory", async () => {
    const root = await tempDir();
    const service = createOpenMembraneService();
    services.push(service);
    const ref = { projectRoot: root, projectId: "project-a", storageDir: root };
    const jsonRef = { ...ref, storageBackend: "json" as const };
    const sqliteRef = { ...ref, storageBackend: "sqlite" as const };
    const json = await service.forProject(jsonRef);
    const sqlite = await service.forProject(sqliteRef);
    const jsonState = await service.projectState(jsonRef);
    const sqliteState = await service.projectState(sqliteRef);
    expect(jsonState.memoryStore).not.toBe(sqliteState.memoryStore);
    await jsonState.memoryStore.save(entry({ id: "json-only", content: "JSON storage keeps its own fixtures." }));
    await sqliteState.memoryStore.save(entry({ id: "sqlite-only", content: "SQLite storage keeps separate fixtures." }));
    expect((await json.searchMemory({})).map((memory) => memory.id)).toEqual(["json-only"]);
    expect((await sqlite.searchMemory({})).map((memory) => memory.id)).toEqual(["sqlite-only"]);
    expect(await service.forProject(jsonRef)).toBe(json);
    expect(await service.forProject(sqliteRef)).toBe(sqlite);
    await service.close();
    await expect(service.forProject(jsonRef)).rejects.toThrow("closed");
    await expect(service.forProject(sqliteRef)).rejects.toThrow("closed");
  });

  it("shares cached stores across symlink aliases including initially missing subdirectories", async () => {
    const root = await tempDir();
    const storage = join(root, "storage");
    const alias = join(root, "alias");
    await mkdir(storage);
    await symlink(storage, alias, process.platform === "win32" ? "junction" : "dir");
    const service = createOpenMembraneService();
    services.push(service);
    const directRef = { projectRoot: root, storageDir: join(storage, "nested"), storageBackend: "json" as const };
    const aliasRef = { ...directRef, storageDir: join(alias, "nested") };
    const [direct, aliased] = await Promise.all([service.forProject(directRef), service.forProject(aliasRef)]);
    expect(aliased).toBe(direct);
    expect((await service.projectState(aliasRef)).memoryStore).toBe((await service.projectState(directRef)).memoryStore);
    expect(direct.storageDir).toBe(await realpath(directRef.storageDir));
  });

  it.skipIf(process.platform !== "darwin")("shares stores across casing aliases on a case-insensitive filesystem", async (context) => {
    const root = await tempDir();
    const storage = join(root, "MixedCaseStorage");
    const alias = join(root, "mixedcasestorage");
    await mkdir(storage);
    try {
      await realpath(alias);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      context.skip();
      return;
    }
    const service = createOpenMembraneService();
    services.push(service);
    const direct = await service.forProject({ projectRoot: root, storageDir: storage });
    expect(await service.forProject({ projectRoot: root, storageDir: alias })).toBe(direct);
  });

  it.each(["json", "sqlite"])("ranks all eligible %s memories before limiting either retrieval tool", async (backend) => {
    vi.stubEnv("OPENMEMBRANE_STORAGE_BACKEND", backend);
    const root = await tempDir();
    const service = createOpenMembraneService();
    services.push(service);
    const ref = { projectRoot: root, projectId: "project-a" };
    const project = await service.forProject(ref);
    const store = (await service.projectState(ref)).memoryStore;
    await store.save(entry({
      id: "old-rule",
      content: "Use pnpm workspace protocol for internal dependencies.",
      updatedAt: "2025-01-01T00:00:00.000Z",
    }));
    for (let i = 0; i < 36; i++) {
      await store.save(entry({
        id: `new-note-${i}`,
        content: `Workspace note ${i} for project setup.`,
        updatedAt: `2026-06-${String(i % 28 + 1).padStart(2, "0")}T00:00:00.000Z`,
      }));
    }
    await store.save(entry({ id: "superseded-rule", content: "Use pnpm workspace protocol.", status: "superseded" }));
    await store.save(entry({ id: "other-project", projectId: "project-b", content: "Use pnpm workspace protocol." }));

    const context = await project.getRelevantContext({ query: "pnpm workspace protocol", limit: 1 });
    const search = await project.searchMemory({ query: "pnpm workspace protocol", limit: 1 });
    expect(context).toMatchObject({ memories: [{ id: "old-rule" }], pendingCandidateCount: 0 });
    expect(search.map((memory) => memory.id)).toEqual(["old-rule"]);
  });

  it("keeps review audit ordering independent of MCP audit sorting", async () => {
    const root = await tempDir();
    const service = createOpenMembraneService();
    services.push(service);
    const ref = { projectRoot: root, projectId: "audit-project" };
    const project = await service.forProject(ref);
    const state = await service.projectState(ref);
    await state.auditLogStore.append({ id: "older-in-store", projectId: ref.projectId, type: "memory_saved", createdAt: "2025-02-01T00:00:00Z" });
    await state.auditLogStore.append({ id: "newer-in-store", projectId: ref.projectId, type: "memory_saved", createdAt: "2025-01-01T00:00:00Z" });

    expect((await project.listReviewAuditLog(1)).map((event) => event.id)).toEqual(["newer-in-store"]);
    expect((await project.listAuditLog({ limit: 1 })).map((event) => event.id)).toEqual(["older-in-store"]);
  });
});
