import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Server } from "node:http";
import { OpenMembraneClientError } from "@openmembrane/client";
import { createId } from "@openmembrane/shared";
import { ZodError } from "zod";
import { Router, type RouteContext } from "./router.js";
import { createMemoryRoutes } from "./routes/memories.js";
import { createCandidateRoutes } from "./routes/candidates.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createDiagnosticsRoutes } from "./routes/diagnostics.js";
import { createExportRoutes } from "./routes/export.js";
import { serveStatic } from "./static.js";
import type { ReviewUiContext } from "./context.js";

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new SyntaxError("Request body is too large."));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

export function createReviewServer(ctx: ReviewUiContext): Server {
  const router = new Router();

  // Register routes
  const memoryRoutes = createMemoryRoutes(ctx.project);
  const candidateRoutes = createCandidateRoutes(ctx.project);
  const auditRoutes = createAuditRoutes(ctx.project);
  const diagnosticsRoutes = createDiagnosticsRoutes(ctx.project);
  const exportRoutes = createExportRoutes(ctx.project);

  router.get("/api/memories", memoryRoutes.listMemories);
  router.get("/api/memories/stale", memoryRoutes.staleMemories);
  router.get("/api/memories/:id", memoryRoutes.getMemory);
  router.register("PATCH", "/api/memories/:id", memoryRoutes.updateMemory);
  router.post("/api/memories/:id/supersede", memoryRoutes.supersedeMemory);
  router.get("/api/candidates", candidateRoutes.listCandidates);
  // Register literal paths before parameterized to avoid conflicts
  router.post("/api/candidates/approve-all", candidateRoutes.approveAll);
  router.post("/api/candidates/reject-all", candidateRoutes.rejectAll);
  router.post("/api/candidates/:id/approve", candidateRoutes.approveCandidate);
  router.post("/api/candidates/:id/reject", candidateRoutes.rejectCandidate);
  router.get("/api/audit", auditRoutes.listAudit);
  router.get("/api/diagnostics", diagnosticsRoutes.listDiagnostics);
  router.post("/api/export/preview", exportRoutes.preview);
  router.post("/api/export", exportRoutes.write);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host;
    const port = req.socket.localPort;
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if ((host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) ||
      (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) ||
      (req.headers["sec-fetch-site"] === "cross-site" && url.pathname.startsWith("/api/"))) {
      const diagnosticId = createId("diag");
      process.stderr.write(`Review UI request failed [FORBIDDEN] (diagnostic: ${diagnosticId})\n`);
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Use the local review UI origin.", code: "FORBIDDEN", diagnosticId }));
      return;
    }
    const method = req.method ?? "GET";
    const pathname = url.pathname;

    // Try API routes first
    const match = router.match(method, pathname);
    if (match) {
      try {
        const body = method === "POST" || method === "PATCH" ? await parseBody(req) : undefined;
        const params = Object.fromEntries(Object.entries(match.params).map(([key, value]) => [key, decodeURIComponent(value)]));
        const routeCtx: RouteContext = { params, query: url.searchParams, body, req, res };
        const result = await match.handler(routeCtx);
        const headers: Record<string, string> = {
          "Content-Type": "application/json; charset=utf-8",
          ...(result.headers ?? {}),
        };
        res.writeHead(result.status, headers);
        if (result.body instanceof Buffer) {
          res.end(result.body);
        } else {
          res.end(JSON.stringify(result.body));
        }
      } catch (error) {
        const clientError = error instanceof OpenMembraneClientError ? error : undefined;
        const invalid = error instanceof ZodError || error instanceof SyntaxError || error instanceof URIError;
        const diagnosticId = clientError?.diagnosticId ?? createId("diag");
        const code = clientError?.code ?? (invalid ? "VALIDATION_ERROR" : "REVIEW_UI_ERROR");
        const status = invalid ? 400 : clientError?.status ??
          (code === "MEMORY_NOT_FOUND" || code === "CANDIDATE_NOT_FOUND" ? 404
            : clientError?.origin === "daemon" ? 422 : clientError ? 503 : 500);
        if (!clientError?.diagnosticId) process.stderr.write(`Review UI request failed [${code}] (diagnostic: ${diagnosticId})\n`);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: clientError?.message ?? (invalid ? "Invalid request." : "Internal server error"),
          code, diagnosticId,
        }));
      }
      return;
    }

    // Fall back to static files
    const staticResult = await serveStatic(pathname);
    const headers: Record<string, string> = staticResult.headers ?? {};
    if (!headers["Content-Type"] && !(staticResult.body instanceof Buffer)) {
      headers["Content-Type"] = "application/json; charset=utf-8";
    }
    res.writeHead(staticResult.status, headers);
    if (staticResult.body instanceof Buffer) {
      res.end(staticResult.body);
    } else if (typeof staticResult.body === "string") {
      res.end(staticResult.body);
    } else {
      res.end(JSON.stringify(staticResult.body));
    }
  });

  return server;
}
