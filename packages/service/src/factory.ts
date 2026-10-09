import { basename, join, resolve } from "node:path";
import { env } from "node:process";
import { IngestionService, MemoryApprovalService, MemoryPipeline, MemoryUpdateService, createExtractor, loadExtractionConfig } from "@openmembrane/core";
import type { AuditLogStore, CollaborationStore, DiagnosticsLogStore, ExtractionDiagnostics, MemoryExtractor, MemoryStore, PendingCandidateStore } from "@openmembrane/core";
import { LlmMemoryExtractor } from "@openmembrane/extractor-llm";
import { AnthropicMemoryExtractor } from "@openmembrane/extractor-anthropic";
import { StaticMemoryExportService } from "@openmembrane/exporters";
import { createId, nowIso } from "@openmembrane/shared";
import { JsonCollaborationStore } from "@openmembrane/storage";
import type { StoreSet } from "@openmembrane/storage";
import { GitHubCli, type CommandRunner } from "./collaboration/GitHubCli";
import { GitHubTeamService } from "./collaboration/GitHubTeamService";

export interface ProjectRef {
  projectRoot: string;
  projectId?: string;
  storageDir?: string;
}

export interface ProjectState {
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
  collaborationStore: CollaborationStore;
  githubTeamService: GitHubTeamService;
}

export interface CreateServiceOptions {
  githubRunner?: CommandRunner;
  deferExtractionInitialization?: boolean;
}

export function resolveProjectRef(ref: ProjectRef): { projectRoot: string; storageDir: string; projectId: string } {
  const projectRoot = resolve(ref.projectRoot);
  return {
    projectRoot,
    storageDir: resolve(ref.storageDir ?? env.OPENMEMBRANE_HOME ?? join(projectRoot, ".openmembrane")),
    projectId: ref.projectId?.trim() || env.OPENMEMBRANE_PROJECT_ID || basename(projectRoot),
  };
}

export async function createProjectState(
  ref: ProjectRef,
  options: CreateServiceOptions = {},
  stores: StoreSet,
): Promise<ProjectState> {
  const { projectRoot, storageDir, projectId: defaultProjectId } = resolveProjectRef(ref);
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

  const buildExtractor = (): MemoryExtractor => createExtractor(extractionConfig, {
    onDiagnostics,
    providers: {
      llm: (config, opts) => new LlmMemoryExtractor(config, opts),
      anthropic: (config, opts) => new AnthropicMemoryExtractor(config, opts),
    },
  });
  let extractor = options.deferExtractionInitialization ? undefined : buildExtractor();
  const pipeline = new MemoryPipeline({
    extractor: extractor ?? {
      extract(input) {
        extractor ??= buildExtractor();
        return extractor.extract(input);
      },
    },
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
  const collaborationStore = new JsonCollaborationStore(storageDir);
  const githubTeamService = new GitHubTeamService({
    collaborationStore,
    memoryStore,
    diagnosticsLogStore,
    github: new GitHubCli(options.githubRunner),
    storageDir,
  });

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
    collaborationStore,
    githubTeamService,
  };
}
