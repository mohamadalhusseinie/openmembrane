import { basename, join, resolve } from "node:path";
import { cwd, env } from "node:process";
import { IngestionService, MemoryApprovalService, MemoryPipeline, MemoryUpdateService, createExtractor, loadExtractionConfig } from "@openmembrain/core";
import type { AuditLogStore, DiagnosticsLogStore, ExtractionDiagnostics, MemoryStore, PendingCandidateStore } from "@openmembrain/core";
import { OpenAiMemoryExtractor } from "@openmembrain/extractor-openai";
import { StaticMemoryExportService } from "@openmembrain/exporters";
import { createId, nowIso } from "@openmembrain/shared";
import { createStores } from "@openmembrain/storage";
import type { StorageBackend, StoreSet } from "@openmembrain/storage";

export interface OpenMembrainMcpContext {
  defaultProjectId: string;
  projectRoot: string;
  storageDir: string;
  memoryStore: MemoryStore;
  pendingCandidateStore: PendingCandidateStore;
  auditLogStore: AuditLogStore;
  diagnosticsLogStore: DiagnosticsLogStore;
  pipeline: MemoryPipeline;
  approvalService: MemoryApprovalService;
  updateService: MemoryUpdateService;
  ingestionService: IngestionService;
  exportService: StaticMemoryExportService;
  close?: () => void;
}

export function createOpenMembrainContext(
  options: Partial<Pick<OpenMembrainMcpContext, "defaultProjectId" | "projectRoot" | "storageDir">> = {}
): OpenMembrainMcpContext {
  const workingDirectory = cwd();
  const projectRoot = resolve(options.projectRoot ?? workingDirectory);
  const storageDir = resolve(options.storageDir ?? env.OPENMEMBRAIN_HOME ?? join(workingDirectory, ".openmembrain"));
  const defaultProjectId = options.defaultProjectId ?? env.OPENMEMBRAIN_PROJECT_ID ?? basename(workingDirectory);

  const backend: StorageBackend = env.OPENMEMBRAIN_STORAGE_BACKEND === "sqlite" ? "sqlite" : "json";
  const stores: StoreSet = createStores({ backend, baseDir: storageDir });
  const { memoryStore, pendingCandidateStore, auditLogStore, diagnosticsLogStore } = stores;

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
    extractor: createExtractor(loadExtractionConfig(), {
      onDiagnostics,
      providers: {
        openai: (config, opts) => new OpenAiMemoryExtractor(config, opts),
      },
    }),
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
  const ingestionService = new IngestionService({ pipeline });
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
    ingestionService,
    exportService,
    ...(stores.close !== undefined ? { close: stores.close } : {}),
  };
}

export function resolveProjectId(context: Pick<OpenMembrainMcpContext, "defaultProjectId">, projectId?: string): string {
  const normalized = projectId?.trim();
  return normalized || context.defaultProjectId;
}
