import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Server } from "node:http";
import { Router, type RouteContext } from "./router.js";
import { createMemoryRoutes } from "./routes/memories.js";
import { createCandidateRoutes } from "./routes/candidates.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createDiagnosticsRoutes } from "./routes/diagnostics.js";
import { serveStatic } from "./static.js";
import type { ReviewUiContext } from "./context.js";

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch { resolve(undefined); }
    });
    req.on("error", () => resolve(undefined));
  });
}

export function createReviewServer(ctx: ReviewUiContext): Server {
  const router = new Router();

  // Register routes
  const memoryRoutes = createMemoryRoutes(ctx.projectId, ctx.memoryStore);
  const candidateRoutes = createCandidateRoutes(ctx.projectId, ctx.pendingCandidateStore, ctx.approvalService);
  const auditRoutes = createAuditRoutes(ctx.projectId, ctx.auditLogStore);
  const diagnosticsRoutes = createDiagnosticsRoutes(ctx.projectId, ctx.diagnosticsLogStore);

  router.get("/api/memories", memoryRoutes.listMemories);
  router.get("/api/memories/:id", memoryRoutes.getMemory);
  router.post("/api/memories/:id/supersede", memoryRoutes.supersedeMemory);
  router.get("/api/candidates", candidateRoutes.listCandidates);
  // Register literal paths before parameterized to avoid conflicts
  router.post("/api/candidates/approve-all", candidateRoutes.approveAll);
  router.post("/api/candidates/reject-all", candidateRoutes.rejectAll);
  router.post("/api/candidates/:id/approve", candidateRoutes.approveCandidate);
  router.post("/api/candidates/:id/reject", candidateRoutes.rejectCandidate);
  router.get("/api/audit", auditRoutes.listAudit);
  router.get("/api/diagnostics", diagnosticsRoutes.listDiagnostics);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";
    const pathname = url.pathname;

    // Try API routes first
    const match = router.match(method, pathname);
    if (match) {
      const body = method === "POST" ? await parseBody(req) : undefined;
      const routeCtx: RouteContext = {
        params: match.params,
        query: url.searchParams,
        body,
        req,
        res,
      };

      try {
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
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
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
