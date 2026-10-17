import { readFile, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReviewUiContext } from "../../../apps/review-ui/src/context";
import { createReviewServer } from "../../../apps/review-ui/src/server";
import { diagnosticsResponseSchema, exportResponseSchema, staleMemoriesResponseSchema } from "@openmembrane/protocol";
import { setupSurfaceDaemon } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
});

async function setup(many = false) {
  vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "mock");
  vi.stubEnv("OPENMEMBRANE_EXTRACTION_ENABLED", "false");
  const fixture = await setupSurfaceDaemon({ many });
  cleanup.push(() => fixture.close());
  const context = await createReviewUiContext({ clientOptions: fixture.clientOptions });
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
