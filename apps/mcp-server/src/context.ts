import { basename, join, resolve } from "node:path";
import { cwd, env } from "node:process";
import { IngestionService, MemoryApprovalService, MemoryPipeline, MemoryUpdateService, createExtractor, loadExtractionConfig } from "@openmembrane/core";
import type { AuditLogStore, DiagnosticsLogStore, ExtractionDiagnostics, MemoryStore, PendingCandidateStore } from "@openmembrane/core";
import { LlmMemoryExtractor } from "@openmembrane/extractor-llm";
import { AnthropicMemoryExtractor } from "@openmembrane/extractor-anthropic";
import { StaticMemoryExportService } from "@openmembrane/exporters";
import { createId, nowIso } from "@openmembrane/shared";
import { createStores } from "@openmembrane/storage";
import type { StorageBackend, StoreSet } from "@openmembrane/storage";

export interface OpenMembraneMcpContext {
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

export async function createOpenMembraneContext(
  options: Partial<Pick<OpenMembraneMcpContext, "defaultProjectId" | "projectRoot" | "storageDir">> = {}
): Promise<OpenMembraneMcpContext> {
  const workingDirectory = cwd();
  const projectRoot = resolve(options.projectRoot ?? workingDirectory);
  const storageDir = resolve(options.storageDir ?? env.OPENMEMBRANE_HOME ?? join(workingDirectory, ".openmembrane"));
  const defaultProjectId = options.defaultProjectId ?? env.OPENMEMBRANE_PROJECT_ID ?? basename(workingDirectory);

  const backend: StorageBackend = env.OPENMEMBRANE_STORAGE_BACKEND === "sqlite" ? "sqlite" : "json";
  const stores: StoreSet = await createStores({ backend, baseDir: storageDir });
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

  const extractionConfig = loadExtractionConfig();

  if (!extractionConfig.enabled || extractionConfig.provider === "mock") {
    await diagnosticsLogStore.append({
      id: createId("diag"),
      projectId: defaultProjectId,
      severity: "info",
      code: "EXTRACTION_MOCK_FALLBACK",
      message: "No extraction API key configured — using MockMemoryExtractor. Only explicitly prefixed text will be extracted.",
      operation: "startup",
      source: "core",
      createdAt: nowIso(),
    });
  }

  const pipeline = new MemoryPipeline({
    extractor: createExtractor(extractionConfig, {
      onDiagnostics,
      providers: {
        llm: (config, opts) => new LlmMemoryExtractor(config, opts),
        anthropic: (config, opts) => new AnthropicMemoryExtractor(config, opts),
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

export function resolveProjectId(context: Pick<OpenMembraneMcpContext, "defaultProjectId">, projectId?: string): string {
  const normalized = projectId?.trim();
  return normalized || context.defaultProjectId;
}
