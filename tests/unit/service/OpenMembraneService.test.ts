import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenMembraneService, resolveProjectRef } from "@openmembrane/service";

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
  services.length = 0;
  directories.length = 0;
});

describe("OpenMembraneService", () => {
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
