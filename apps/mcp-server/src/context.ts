import { basename, join, resolve } from "node:path";
import { cwd, env } from "node:process";
import { MemoryApprovalService, MemoryPipeline, MemoryUpdateService, createExtractor, loadExtractionConfig } from "@openmembrain/core";
import type { ExtractionDiagnostics } from "@openmembrain/core";
import { StaticMemoryExportService } from "@openmembrain/exporters";
import { createId, nowIso } from "@openmembrain/shared";
import { JsonAuditLogStore, JsonDiagnosticsLogStore, JsonMemoryStore, JsonPendingCandidateStore } from "@openmembrain/storage";

export interface OpenMembrainMcpContext {
  defaultProjectId: string;
  projectRoot: string;
  storageDir: string;
  memoryStore: JsonMemoryStore;
  pendingCandidateStore: JsonPendingCandidateStore;
  auditLogStore: JsonAuditLogStore;
  diagnosticsLogStore: JsonDiagnosticsLogStore;
  pipeline: MemoryPipeline;
  approvalService: MemoryApprovalService;
  updateService: MemoryUpdateService;
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
  const diagnosticsLogStore = new JsonDiagnosticsLogStore(storageDir);

  const onDiagnostics = (diagnostics: ExtractionDiagnostics): void => {
    const severity = diagnostics.errors.length > 0 ? "warning" as const : "info" as const;
    void diagnosticsLogStore.append({
      id: createId("diag"),
      projectId: defaultProjectId,
      severity,
      code: diagnostics.errors.length > 0 ? "EXTRACTION_PROVIDER_ERROR" : "EXTRACTION_COMPLETE",
      message: `Extraction processed ${diagnostics.chunks} chunk(s): ${diagnostics.candidatesExtracted} candidate(s) extracted, ${diagnostics.errors.length} error(s).`,
      operation: "extraction",
      source: "core",
      createdAt: nowIso(),
      details: {
        chunks: diagnostics.chunks,
        totalPromptTokens: diagnostics.totalPromptTokens,
        totalCompletionTokens: diagnostics.totalCompletionTokens,
        candidatesExtracted: diagnostics.candidatesExtracted,
        errors: diagnostics.errors,
      },
    });
  };

  const pipeline = new MemoryPipeline({
    extractor: createExtractor(loadExtractionConfig(), { onDiagnostics }),
    memoryStore,
    pendingCandidateStore,
    auditLogStore
  });
  const approvalService = new MemoryApprovalService({
    memoryStore,
    pendingCandidateStore,
    auditLogStore
  });
  const updateService = new MemoryUpdateService({
    memoryStore,
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
    diagnosticsLogStore,
    pipeline,
    approvalService,
    updateService,
    exportService
  };
}

export function resolveProjectId(context: Pick<OpenMembrainMcpContext, "defaultProjectId">, projectId?: string): string {
  const normalized = projectId?.trim();
  return normalized || context.defaultProjectId;
}
