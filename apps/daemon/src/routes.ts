import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { normalizeOpenMembraneError } from "@openmembrane/core";
import { endpoints } from "@openmembrane/protocol";
import type { EndpointName, EndpointRequest } from "@openmembrane/protocol";
import type { OpenMembraneService, ProjectRef, ProjectService } from "@openmembrane/service";
import { canonicalStoragePath } from "@openmembrane/service";
import { createId } from "@openmembrane/shared";
import { Router } from "../../review-ui/src/router";
import type { RouteResponse } from "../../review-ui/src/router";
import type { DaemonLogger } from "./logging";

type ProjectEndpoint = Exclude<EndpointName, "health">;
type Handlers = { [K in ProjectEndpoint]: (project: ProjectService, input: EndpointRequest<K>) => Promise<unknown> };

const handlers: Handlers = {
  remember: (project, input) => project.remember(input),
  ingest: (project, input) => project.proposeMemoryFromSession(input),
  getProjectRules: (project, input) => project.getProjectRules(input),
  getRelevantContext: (project, input) => project.getRelevantContext(input),
  searchMemory: (project, input) => project.searchMemory(input),
  listMemoryCandidates: (project, input) => project.listMemoryCandidates(input),
  approveMemoryCandidate: (project, input) => project.approveMemoryCandidate(input),
  rejectMemoryCandidate: (project, input) => project.rejectMemoryCandidate(input),
  approveAllCandidates: (project, input) => project.approveAllCandidates(input),
  rejectAllCandidates: (project, input) => project.rejectAllCandidates(input),
  updateMemory: (project, input) => project.updateMemory(input),
  supersedeMemory: (project, input) => project.supersedeMemory(input),
  reviewStaleMemories: (project, input) => project.reviewStaleMemories(input),
  exportStaticMemoryFiles: (project, input) => project.exportStaticMemoryFiles(input),
  getDiagnostics: (project, input) => project.getDiagnostics(input),
  listAuditLog: (project, input) => project.listAuditLog(input),
  configureGitHubTeamMode: (project, input) => project.configureGitHubTeamMode(input),
  getCollaborationStatus: (project, input) => project.getCollaborationStatus(input),
};

const collaborationOperations = new Set<ProjectEndpoint>([
  "remember", "ingest", "getProjectRules", "getRelevantContext", "searchMemory",
  "approveMemoryCandidate", "approveAllCandidates", "updateMemory", "supersedeMemory",
  "reviewStaleMemories", "exportStaticMemoryFiles", "getCollaborationStatus",
]);

const retrievalOperations = new Set<ProjectEndpoint>(["getProjectRules", "getRelevantContext", "searchMemory"]);

export async function safeError(logger: DaemonLogger, status: number, code: string, safeMessage: string): Promise<RouteResponse> {
  const diagnosticId = createId("diag");
  await logger.write("request_failed", diagnosticId, code);
  return { status, body: { error: { code, safeMessage, diagnosticId } } };
}

export function createDaemonRouter(service: OpenMembraneService, logger: DaemonLogger): Router {
  const router = new Router();
  const queues = new Map<string, Promise<void>>();
  router.get(endpoints.health.path, () => ({ status: 200, body: {} }));

  async function withStore<T>(ref: ProjectRef, operation: () => Promise<T>): Promise<T> {
    const path = await canonicalStoragePath(resolve(ref.projectRoot, ref.storageDir ?? ".openmembrane"));
    const key = process.platform === "win32" ? path.toLowerCase() : path;
    const previous = queues.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const completion = new Promise<void>((resolveCompletion) => { release = resolveCompletion; });
    const tail = previous.then(() => completion);
    queues.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (queues.get(key) === tail) queues.delete(key);
    }
  }

  function register<K extends ProjectEndpoint>(name: K): void {
    const definition = endpoints[name];
    router.register(definition.method, definition.path, async ({ params, query, body }) => {
      let raw = body;
      if (definition.method === "GET") {
        try {
          raw = JSON.parse(query.get("input") ?? "");
        } catch {
          return safeError(logger, 400, "VALIDATION_ERROR", "Provide a JSON input query parameter.");
        }
      }
      const parsed = definition.request.safeParse(raw);
      if (!parsed.success) return safeError(logger, 400, "VALIDATION_ERROR", "The request does not match the daemon protocol.");
      const input = parsed.data;
      const projectRoot = resolve(input.projectRoot);
      if ("idField" in definition) {
        let routeId: string;
        try {
          routeId = decodeURIComponent(params.id ?? "");
        } catch {
          return safeError(logger, 400, "VALIDATION_ERROR", "The route ID is invalid.");
        }
        if (!("candidateId" in input ? input.candidateId === routeId : "memoryId" in input && input.memoryId === routeId)) {
          return safeError(logger, 400, "VALIDATION_ERROR", "The route ID must match the request ID.");
        }
      }
      try {
        if (!(await stat(projectRoot)).isDirectory()) throw new Error("Not a directory.");
      } catch {
        return safeError(logger, 400, "VALIDATION_ERROR", "projectRoot must identify an existing absolute directory.");
      }
      // Supply every routing default explicitly: the daemon's environment is not the caller's.
      const projectId = input.projectId ?? basename(projectRoot);
      if (projectId.trim().length === 0) {
        return safeError(logger, 400, "VALIDATION_ERROR", "Provide an explicit projectId for a filesystem-root project.");
      }
      const ref: ProjectRef = {
        projectRoot,
        projectId,
        storageDir: input.storageDir ?? join(projectRoot, ".openmembrane"),
        storageBackend: input.storageBackend ?? "json",
      };
      try {
        return await withStore(ref, async () => {
          const project = await service.forProject(ref);
          if (collaborationOperations.has(name)) {
            const unavailable = await project.checkCollaborationAvailability();
            if (unavailable) return safeError(logger, 503, unavailable.code, unavailable.message);
          }
          const result = await handlers[name](project, input as EndpointRequest<K>);
          if (name === "configureGitHubTeamMode") {
            const configured = endpoints.configureGitHubTeamMode.response.parse(result);
            if (configured.kind === "rejected") return safeError(logger, 422, configured.code, configured.message);
          }
          const response: RouteResponse = { status: 200, body: definition.response.parse(result) };
          if (retrievalOperations.has(name)) {
            response.afterResponse = async () => {
              try {
                await withStore(ref, () => project.retryEligiblePublications());
              } catch {
                await logger.write("publication_retry_failed", createId("diag"), "GITHUB_PUBLICATION_FAILED");
              }
            };
          }
          return response;
        });
      } catch (error) {
        const normalized = normalizeOpenMembraneError(error);
        const status = normalized.code === "CANDIDATE_NOT_FOUND" || normalized.code === "MEMORY_NOT_FOUND"
          ? 404 : normalized.code === "UNKNOWN_ERROR" || normalized.code === "STORAGE_ERROR" ? 500 : 422;
        return safeError(logger, status, normalized.code, normalized.safeMessage);
      }
    });
  }
  for (const name of Object.keys(handlers) as ProjectEndpoint[]) register(name);
  return router;
}
