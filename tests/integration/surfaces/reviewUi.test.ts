import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReviewUiContext } from "../../../apps/review-ui/src/context";
import { createReviewServer } from "../../../apps/review-ui/src/server";
import { diagnosticsResponseSchema, exportResponseSchema, knowledgeGraphResponseSchema, staleMemoriesResponseSchema } from "@openmembrane/protocol";
import { setupSurfaceDaemon } from "./helpers";
import { OpenMembraneClient, OpenMembraneClientError } from "@openmembrane/client";
import { MemoryApprovalService } from "@openmembrane/core";
import { createOpenMembraneService } from "@openmembrane/service";
import { createStores } from "@openmembrane/storage";
import { candidate, entry } from "../../unit/helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function setup(many = false, timeoutMs?: number) {
  vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "mock");
  vi.stubEnv("OPENMEMBRANE_EXTRACTION_ENABLED", "false");
  const fixture = await setupSurfaceDaemon({ many });
  cleanup.push(() => fixture.close());
  const context = await createReviewUiContext({
    clientOptions: fixture.clientOptions, ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const server = createReviewServer(context);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await context.close();
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP address.");
  const request = (path: string, method = "GET", body?: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...fixture, request, url: `http://127.0.0.1:${address.port}` };
}

describe("review UI proxy and real daemon", { timeout: 20_000 }, () => {
  it("awaits long mutations and reports uncertain completion on a configured timeout", async () => {
    const approveAll = vi.spyOn(MemoryApprovalService.prototype, "approveAll").mockImplementation(async projectId => {
      await new Promise(resolve => setTimeout(resolve, 31_000));
      return { projectId, approved: [], skipped: [] };
    });
    const { request } = await setup();
    const start = performance.now();
    const completed = await request("/api/candidates/approve-all", "POST");
    expect(completed.status).toBe(200);
    expect(performance.now() - start).toBeGreaterThan(30_000);
    approveAll.mockImplementation(async projectId => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return { projectId, approved: [], skipped: [] };
    });
    const shortDeadline = await setup(false, 500);
    const response = await shortDeadline.request("/api/candidates/approve-all", "POST");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "E_REQUEST_TIMEOUT", error: expect.stringContaining("may still be processing; check context and audit before retrying"),
    });
    expect(approveAll).toHaveBeenCalledTimes(2);
  }, 45_000);

  it("exercises every data route, memory mutation, export preview, and export write", async () => {
    const { request, projectRoot } = await setup();
    const page = await request("/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Preview files");
    const memories = await (await request("/api/memories")).json();
    expect(memories).toHaveLength(2);
    expect(await (await request("/api/memories?type=coding_rule&scope=frontend&q=standalone&limit=1")).json()).toHaveLength(1);
    expect(await (await request("/api/memories/old%20memory")).json()).toMatchObject({ id: "old memory" });
    expect((await request("/api/memories/missing")).status).toBe(404);
    const stale = staleMemoriesResponseSchema.parse(await (await request("/api/memories/stale?staleAfterMonths=6")).json());
    expect(stale.some((memory: { id: string }) => memory.id === "old memory")).toBe(true);
    const updated = await request("/api/memories/old%20memory", "PATCH", {
      content: "The frontend must use strict ESM modules.", type: "coding_rule", scope: "frontend", tags: ["esm"],
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ content: "The frontend must use strict ESM modules.", tags: ["esm"] });
    expect(await (await request("/api/memories/old%20memory/supersede", "POST", { reason: "Obsolete" })).json()).toMatchObject({ status: "superseded" });
    expect(await (await request("/api/candidates")).json()).toHaveLength(4);
    expect(await (await request("/api/candidates/approve%20candidate/approve", "POST")).json()).toMatchObject({ ok: true, memory: { status: "active" } });
    expect(await (await request("/api/candidates/reject-candidate/reject", "POST", { reason: "Obsolete" })).json()).toEqual({ ok: true });
    expect(await (await request("/api/candidates/approve-all", "POST")).json()).toMatchObject({
      approved: 1, skipped: [{ candidateId: "secret-candidate" }],
    });
    expect(await (await request("/api/candidates/reject-all", "POST", { reason: "Cleanup" })).json()).toEqual({ rejected: 1 });
    expect(await (await request("/api/audit?limit=2")).json()).toHaveLength(2);
    const diagnostics = diagnosticsResponseSchema.parse(await (await request("/api/diagnostics?severity=info&code=EXTRACTION_MOCK_FALLBACK&limit=2")).json());
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("EXTRACTION_MOCK_FALLBACK");
    const preview = await request("/api/export/preview", "POST", { targets: ["agents"], preview: false });
    expect(preview.status).toBe(200);
    const files = exportResponseSchema.parse(await preview.json()).files;
    expect(files[0]!.content).not.toContain("Private deployment architecture");
    await expect(stat(join(projectRoot, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
    const written = await request("/api/export", "POST", { targets: ["agents"], outputDir: "exported", includeConfidential: true });
    expect(written.status).toBe(200);
    expect(await readFile(join(projectRoot, "exported", "AGENTS.md"), "utf8")).toContain("Private deployment architecture");
  });

  it("does not truncate existing memory or candidate listings", async () => {
    const { request } = await setup(true);
    expect(await (await request("/api/memories")).json()).toHaveLength(207);
    expect(await (await request("/api/candidates")).json()).toHaveLength(209);
  });

  it("limits audit entries by append order rather than timestamps", async () => {
    const { request, client } = await setup();
    expect(await (await request("/api/audit?limit=2")).json()).toMatchObject([
      { id: "latest-append" }, { id: "same-time-append" },
    ]);
    expect(await client.listAuditLog({ limit: 2 })).toMatchObject([
      { id: "older-append" }, { id: "same-time-append" },
    ]);
  });

  it("serves bounded, filtered graph data and privacy-safe entity details through the daemon client", async () => {
    const { request, storageDir, projectId, projectRoot } = await setup();
    const stores = await createStores({ backend: "json", baseDir: storageDir });
    try {
      await stores.memoryStore.save(entry({
        projectId, id: "graph-memory", tags: ["graph-safe"],
        source: { kind: "session", sessionId: "run.alice.private-project", tool: "copilot", excerpt: "Saved excerpt api_key=abcdefghijk123456" },
      }));
      await stores.pendingCandidateStore.save(candidate({
        projectId, id: "secret-shaped-candidate",
        content: "Do not expose api_key=abcdefghijk123456 in graph data.",
      }));
      await stores.auditLogStore.append({
        id: "graph-audit", projectId, type: "memory_saved", entityId: "graph-memory",
        createdAt: "2026-06-01T00:00:00.000Z",
      });
      await stores.diagnosticsLogStore.append({
        id: "graph-diagnostic", projectId, severity: "warning", code: "GRAPH_TEST",
        message: "Diagnostic api_key=abcdefghijk123456", entityId: "graph-memory",
        createdAt: "2026-06-01T00:00:00.000Z",
      });
      await stores.diagnosticsLogStore.append({
        id: "orphan-diagnostic", projectId, severity: "warning", code: "ORPHAN_DIAGNOSTIC",
        message: "This event references an entity that is not in the graph.", entityId: "missing-memory",
        createdAt: "2026-06-01T00:00:00.000Z",
      });
      await stores.auditLogStore.append({
        id: "duplicate-rejection", projectId, type: "candidate_rejected", entityId: "historical-candidate",
        createdAt: "2026-06-01T00:00:00.000Z", details: { duplicateOf: "old memory" },
      });
      await stores.auditLogStore.append({
        id: "supersession-event", projectId, type: "memory_superseded", entityId: "old memory",
        createdAt: "2026-06-01T00:00:00.000Z", details: { replacementId: "graph-memory" },
      });
    } finally {
      await stores.close?.();
    }

    const graphService = createOpenMembraneService();
    const tagId = `tag_${createHash("sha256").update("tag:graph-safe").digest("hex").slice(0, 24)}`;
    const sessionId = `session_${createHash("sha256").update("run.alice.private-project").digest("hex").slice(0, 24)}`;
    try {
      const project = await graphService.forProject({ projectRoot, projectId, storageDir });
      await project.createRelationship({
        source: { kind: "memory", id: "graph-memory" },
        target: { kind: "tag", id: tagId },
        type: "supports",
        rationale: "same source session: run.alice.private-project; supporting context.",
      });
      await project.createRelationship({
        source: { kind: "memory", id: "graph-memory" },
        target: { kind: "session", id: sessionId },
        type: "supports",
        rationale: "Reviewed session relationship.",
      });
      const removed = await project.createRelationship({
        source: { kind: "memory", id: "graph-memory" },
        target: { kind: "tag", id: tagId },
        type: "tagged_with",
        rationale: "Manual replacement for the generated tag edge.",
      });
      await project.removeRelationship({ relationshipId: removed.id, rationale: "Hide this generated grouping edge." });
    } finally {
      await graphService.close();
    }

    const graphResponse = await request("/api/graph?kind=memory&kind=tag&limit=20");
    expect(graphResponse.status).toBe(200);
    const graph = knowledgeGraphResponseSchema.parse(await graphResponse.json());
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "graph-memory", kind: "memory", sourceExcerpt: expect.stringContaining("[REDACTED:") }),
      expect.objectContaining({ kind: "tag", label: "tag: graph-safe" }),
      expect.objectContaining({ kind: "tag", label: "scope: frontend" }),
      expect.objectContaining({ kind: "tag", label: "type: coding_rule" }),
    ]));
    expect(graph.nodes.some((node: { kind: string }) => node.kind === "audit_event" || node.kind === "diagnostic")).toBe(false);
    expect(graph.edges.some((edge: { type: string }) => edge.type === "tagged_with")).toBe(true);

    const allKinds = knowledgeGraphResponseSchema.parse(await (await request("/api/graph")).json());
    expect(allKinds.nodes.length).toBeLessThanOrEqual(500);
    expect(JSON.stringify(allKinds)).not.toContain("private-session-identifier");
    expect(JSON.stringify(allKinds)).not.toContain("alice.private-project");
    expect(JSON.stringify(allKinds)).not.toContain("abcdefghijk123456");
    expect(allKinds.nodes.some((node: { id: string }) => node.id === "secret-shaped-candidate")).toBe(false);
    expect(allKinds.nodes.some((node: { id: string }) => node.id === "secret-candidate")).toBe(false);
    expect(allKinds.nodes.some((node: { kind: string }) => node.kind === "session")).toBe(true);
    expect(allKinds.nodes.some((node: { kind: string }) => node.kind === "audit_event")).toBe(true);
    expect(allKinds.nodes.some((node: { kind: string }) => node.kind === "diagnostic")).toBe(true);
    expect(allKinds.nodes.some((node: { id: string }) => node.id === "orphan-diagnostic")).toBe(false);
    expect(allKinds.nodes.some((node: { kind: string; id: string }) => node.kind === "candidate" && node.id === "historical-candidate")).toBe(true);
    expect(allKinds.edges.some((edge: { type: string; origin: string }) => edge.type === "duplicate_of" && edge.origin === "derived")).toBe(true);
    expect(allKinds.edges.some((edge: { type: string; origin: string }) => edge.type === "supports" && edge.origin === "manual")).toBe(true);
    expect(allKinds.edges.some((edge: { type: string; source: { id: string }; target: { id: string } }) =>
      edge.type === "supports" && edge.source.id === "graph-memory" && edge.target.id === sessionId
    )).toBe(true);
    expect(allKinds.edges.find((edge: { type: string; source: { id: string }; target: { id: string } }) =>
      edge.type === "supports" && edge.source.id === "graph-memory" && edge.target.id === tagId
    )?.rationale).not.toContain("alice.private-project");
    expect(allKinds.edges.some((edge: { source: { id: string }; target: { id: string }; type: string }) =>
      edge.source.id === "supersession-event" && edge.target.id === "graph-memory" && edge.type === "derived_from"
    )).toBe(true);
    expect(allKinds.edges.some((edge: { type: string; source: { id: string }; target: { id: string } }) =>
      edge.type === "tagged_with" && edge.source.id === "graph-memory" && edge.target.id === tagId
    )).toBe(false);
    expect(allKinds.nodes.some((node: { label: string }) => node.label.includes("EXTRACTION_MOCK_FALLBACK"))).toBe(true);

    const detail = await request("/api/graph/entities/memory/graph-memory");
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      entity: { id: "graph-memory", kind: "memory" },
      edges: expect.arrayContaining([expect.objectContaining({ type: "derived_from" })]),
    });
    expect((await request("/api/graph/entities/memory/missing")).status).toBe(404);
    for (const path of ["/api/graph?kind=invalid", "/api/graph?relationshipType=invalid", "/api/graph?limit=501"]) {
      expect((await request(path)).status, path).toBe(400);
    }
  });

  it("prioritizes memories over large event histories and keeps bounded entity edges self-contained", async () => {
    const { client, storageDir, projectId } = await setup();
    const stores = await createStores({ backend: "json", baseDir: storageDir });
    try {
      for (let index = 0; index < 510; index++) {
        await stores.auditLogStore.append({
          id: `graph-history-${index}`, projectId, type: "memory_saved", entityId: "old memory",
          createdAt: `2026-06-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
        });
      }
    } finally {
      await stores.close?.();
    }

    const eventHeavy = await client.getKnowledgeGraph();
    expect(eventHeavy.nodes).toHaveLength(500);
    expect(eventHeavy.nodes.some((node) => node.kind === "memory")).toBe(true);
    expect(eventHeavy.nodes.some((node) => node.kind === "candidate")).toBe(true);

    const memoryStores = await createStores({ backend: "json", baseDir: storageDir });
    try {
      for (let index = 0; index < 500; index++) {
        await memoryStores.memoryStore.save(entry({
          projectId,
          id: `bounded-memory-${index}`,
          content: `Unique graph fixture memory ${index} stores a separate convention.`,
        }));
      }
    } finally {
      await memoryStores.close?.();
    }

    const detail = await client.getKnowledgeGraphEntity({ kind: "session", id: "session_unknown" });
    expect(detail.neighbors).toHaveLength(499);
    expect(detail.truncated).toBe(true);
    const visible = new Set([
      JSON.stringify([detail.entity.kind, detail.entity.id]),
      ...detail.neighbors.map((node) => JSON.stringify([node.kind, node.id])),
    ]);
    expect(detail.edges.every((edge) =>
      visible.has(JSON.stringify([edge.source.kind, edge.source.id])) &&
      visible.has(JSON.stringify([edge.target.kind, edge.target.id]))
    )).toBe(true);
  }, 60_000);

  it.each([
    ["STORAGE_ERROR", 500], ["GITHUB_UNAVAILABLE", 503],
  ])("preserves daemon %s HTTP failures in proxy responses", async (code, status) => {
    const { request } = await setup();
    vi.spyOn(OpenMembraneClient.prototype, "listMemories").mockRejectedValue(new OpenMembraneClientError(
      code, "A safe daemon failure.", { origin: "daemon", status, diagnosticId: "diag_daemon" },
    ));
    const response = await request("/api/memories");
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: "A safe daemon failure.", code, diagnosticId: "diag_daemon" });
  });

  it("preserves safe diagnostic errors and rejects invalid inputs before mutation", async () => {
    const { request, url } = await setup();
    const secret = await request("/api/candidates/secret-candidate/approve", "POST");
    expect(secret.status).toBe(422);
    expect(await secret.json()).toMatchObject({ code: "SECRET_CANDIDATE", diagnosticId: expect.any(String) });
    expect((await request("/api/memories/missing/supersede", "POST")).status).toBe(404);
    expect((await request("/api/candidates/missing/reject", "POST")).status).toBe(404);
    for (const path of ["/api/memories?limit=oops", "/api/memories?scope=invalid", "/api/diagnostics?severity=invalid", "/api/audit?limit=-1", "/api/memories/stale?staleAfterMonths=0", "/api/memories/%ZZ"]) {
      const result = await request(path);
      expect(result.status, path).toBe(400);
      expect(await result.json()).toMatchObject({ code: "VALIDATION_ERROR", diagnosticId: expect.any(String) });
    }
    expect((await request("/api/export/preview", "POST", { targets: ["invalid"] })).status).toBe(400);
    expect((await request("/api/candidates/reject-all", "POST", { reason: 42 })).status).toBe(400);
    const malformed = await fetch(`${url}/api/candidates/reject-all`, { method: "POST", body: "{" });
    expect(malformed.status).toBe(400);
    expect(await (await request("/api/candidates")).json()).toHaveLength(4);
  });

  it("does not allow browser-supplied project fields to change the bound project", async () => {
    const { request } = await setup();
    const response = await request("/api/memories/old%20memory", "PATCH", {
      content: "The bound project must use strict TypeScript settings.",
      projectId: "different-project", projectRoot: "relative", storageDir: "relative",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectId: "surface-project" });
    expect(await (await request("/api/memories?projectId=other&storageDir=relative")).json()).toHaveLength(2);
  });

  it("reports unavailable daemons rather than opening an in-process store", async () => {
    const { request, daemon } = await setup();
    await daemon.close();
    const response = await request("/api/memories");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "E_DAEMON_NOT_RUNNING", diagnosticId: expect.any(String) });
  });

  it("rejects cross-origin requests and non-loopback Host values", async () => {
    const { request, url } = await setup();
    for (const headers of [
      { origin: "https://untrusted.example" },
      { host: "rebound.example" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      const response = await new Promise<{ status: number | undefined; body: unknown }>((resolve, reject) => {
        const outgoing = httpRequest(`${url}/api/export`, { method: "POST", headers }, (incoming) => {
          let body = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => { body += chunk; });
          incoming.on("end", () => resolve({ status: incoming.statusCode, body: JSON.parse(body) }));
          incoming.on("error", reject);
        });
        outgoing.on("error", reject);
        outgoing.end();
      });
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: "FORBIDDEN", diagnosticId: expect.any(String) });
    }
    expect((await fetch(url, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(200);
    expect((await request("/api/memories")).status).toBe(200);
  });
});
