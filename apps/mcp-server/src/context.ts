import { basename, join, resolve } from "node:path";
import { cwd, env } from "node:process";
import { MemoryApprovalService, MemoryPipeline, MockMemoryExtractor } from "@openmembrain/core";
import { StaticMemoryExportService } from "@openmembrain/exporters";
import { JsonAuditLogStore, JsonMemoryStore, JsonPendingCandidateStore } from "@openmembrain/storage";

export interface OpenMembrainMcpContext {
  defaultProjectId: string;
  projectRoot: string;
  storageDir: string;
  memoryStore: JsonMemoryStore;
  pendingCandidateStore: JsonPendingCandidateStore;
  auditLogStore: JsonAuditLogStore;
  pipeline: MemoryPipeline;
  approvalService: MemoryApprovalService;
  exportService: StaticMemoryExportService;
}

export function createOpenMembrainContext(
  options: Partial<Pick<OpenMembrainMcpContext, "defaultProjectId" | "projectRoot" | "storageDir">> = {}
): OpenMembrainMcpContext {
  const workingDirectory = cwd();
  const projectRoot = resolve(options.projectRoot ?? workingDirectory);
  const storageDir = resolve(options.storageDir ?? env.OPENMEMBRAIN_HOME ?? join(workingDirectory, ".openmembrain"));
  const defaultProjectId = options.defaultProjectId ?? env.OPENMEMBRAIN_PROJECT_ID ?? basename(workingDirectory);

  const memoryStore = new JsonMemoryStore(storageDir);
  const pendingCandidateStore = new JsonPendingCandidateStore(storageDir);
  const auditLogStore = new JsonAuditLogStore(storageDir);
  const pipeline = new MemoryPipeline({
    extractor: new MockMemoryExtractor(),
    memoryStore,
    pendingCandidateStore,
    auditLogStore
  });
  const approvalService = new MemoryApprovalService({
    memoryStore,
    pendingCandidateStore,
    auditLogStore
  });
  const exportService = new StaticMemoryExportService();

  return {
    defaultProjectId,
    projectRoot,
    storageDir,
    memoryStore,
    pendingCandidateStore,
    auditLogStore,
    pipeline,
    approvalService,
    exportService
  };
}

export function resolveProjectId(context: Pick<OpenMembrainMcpContext, "defaultProjectId">, projectId?: string): string {
  const normalized = projectId?.trim();
  return normalized || context.defaultProjectId;
}
