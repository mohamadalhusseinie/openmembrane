import { resolve } from "node:path";
import { rankMemories, annotateConflicts, SecretDetector, OpenMembraneError, mapPipelineResult, type Confidence, type DiagnosticSeverity, type IngestionRequest, type IngestionResult, type MemoryCandidate, type MemoryScope, type MemorySearchOptions, type MemoryType, type SecretFinding } from "@openmembrane/core";
import type { ExportTarget } from "@openmembrane/exporters";
import type { OpenMembraneMcpContext } from "../context";
import { createId, nowIso } from "@openmembrane/shared";
import { resolveProjectId } from "../context";
import type { CollaborationProposal, MemoryEntry } from "@openmembrane/core";
import type { PublishAcceptedMemoryResult } from "../collaboration/GitHubTeamService";

const ruleTypes: MemoryType[] = [
  "coding_rule",
  "architecture_decision",
  "known_gotcha",
  "testing_rule",
  "deployment_rule",
  "security_rule",
  "forbidden_pattern"
];

export interface ProjectScopedInput {
  projectId?: string | undefined;
}

export interface ProposeMemoryInput extends ProjectScopedInput {
  transcript?: string | undefined;
  summary?: string | undefined;
  tool?: string | undefined;
  sessionId?: string | undefined;
  metadata?: Record<string, string | number | boolean> | undefined;
}

export interface GetProjectRulesInput extends ProjectScopedInput {
  scope?: MemoryScope | undefined;
  limit?: number | undefined;
}

export interface GetRelevantContextInput extends ProjectScopedInput {
  query: string;
  scope?: MemoryScope | undefined;
  limit?: number | undefined;
}

export interface SearchMemoryInput extends ProjectScopedInput {
  query?: string | undefined;
  scopes?: MemoryScope[] | undefined;
  types?: MemoryType[] | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
}

export interface ConfigureGitHubTeamModeInput extends ProjectScopedInput {
  repository: { host: string; owner: string; name: string };
}

export type GetCollaborationStatusInput = ProjectScopedInput;

export interface ListMemoryCandidatesInput extends ProjectScopedInput {
  limit?: number | undefined;
}

export interface ApproveMemoryCandidateInput extends ProjectScopedInput {
  candidateId: string;
}

export interface RejectMemoryCandidateInput extends ProjectScopedInput {
  candidateId: string;
  reason?: string | undefined;
}

export interface ExportStaticMemoryFilesInput extends ProjectScopedInput {
  targets?: ExportTarget[] | undefined;
  outputDir?: string | undefined;
  includeConfidential?: boolean | undefined;
}

export interface GetDiagnosticsInput extends ProjectScopedInput {
  severity?: DiagnosticSeverity | undefined;
  code?: string | undefined;
  limit?: number | undefined;
}

export interface ListAuditLogInput extends ProjectScopedInput {
  limit?: number | undefined;
}

export interface SupersedeMemoryInput extends ProjectScopedInput {
  memoryId: string;
  reason?: string | undefined;
  replacementId?: string | undefined;
}

export interface UpdateMemoryInput extends ProjectScopedInput {
  memoryId: string;
  content?: string | undefined;
  type?: MemoryType | undefined;
  scope?: MemoryScope | undefined;
  tags?: string[] | undefined;
}

export interface ReviewStaleMemoriesInput extends ProjectScopedInput {
  staleAfterMonths?: number | undefined;
}

export type ApproveAllCandidatesInput = ProjectScopedInput;

export interface RejectAllCandidatesInput extends ProjectScopedInput {
  reason?: string | undefined;
}

export interface RememberItemInput {
  content: string;
  type: MemoryType;
  scope?: MemoryScope | undefined;
  confidence?: Confidence | undefined;
  tags?: string[] | undefined;
}

export interface RememberInput extends ProjectScopedInput {
  content?: string | undefined;
  type?: MemoryType | undefined;
  scope?: MemoryScope | undefined;
  confidence?: Confidence | undefined;
  tags?: string[] | undefined;
  items?: RememberItemInput[] | undefined;
}

export function createToolHandlers(context: OpenMembraneMcpContext) {
  return {
    proposeMemoryFromSession: async (input: ProposeMemoryInput) => {
      const request: IngestionRequest = {
        projectId: resolveProjectId(context, input.projectId)
      };
      if (input.transcript) {
        request.transcript = input.transcript;
      }
      if (input.summary) {
        request.summary = input.summary;
      }
      if (input.tool) {
        request.tool = input.tool;
      }
      if (input.sessionId) {
        request.sessionId = input.sessionId;
      }
      if (input.metadata) {
        request.metadata = input.metadata;
      }
      const result = await context.ingestionService.ingest(request, {
        preserveExistingConflicts: await isGitHubTeamMode(context, request.projectId),
      });
      return publishAcceptedInGitHubMode(context, request.projectId, result);
    },

    getProjectRules: async (input: GetProjectRulesInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      await context.githubTeamService.refreshBeforeRetrieval(projectId);
      const options: MemorySearchOptions = {
        limit: input.limit ?? 50,
        types: ruleTypes
      };
      if (input.scope) {
        options.scopes = [input.scope];
      }
      const rules = await context.memoryStore.search(projectId, "", options);
      const pending = await context.pendingCandidateStore.list(projectId);
      return { rules, pendingCandidateCount: pending.length };
    },

    getRelevantContext: async (input: GetRelevantContextInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      await context.githubTeamService.refreshBeforeRetrieval(projectId);
      const limit = input.limit ?? 10;
      const options: MemorySearchOptions = {
        limit: limit * 3
      };
      if (input.scope) {
        options.scopes = [input.scope];
      }
      const candidates = await context.memoryStore.search(projectId, input.query, options);
      const ranked = rankMemories(candidates, input.query, "context", undefined, input.scope)
        .slice(0, limit);
      const annotated = annotateConflicts(ranked);
      const memories = annotated.map((scored) => {
        if (scored.conflicts && scored.conflicts.length > 0) {
          return { ...scored.entry, conflicts: scored.conflicts };
        }
        return scored.entry;
      });
      const pending = await context.pendingCandidateStore.list(projectId);
      return { memories, pendingCandidateCount: pending.length };
    },

    searchMemory: async (input: SearchMemoryInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      await context.githubTeamService.refreshBeforeRetrieval(projectId);
      const limit = input.limit ?? 20;
      const options: MemorySearchOptions = {
        limit: limit * 3
      };
      if (input.scopes) {
        options.scopes = input.scopes;
      }
      if (input.types) {
        options.types = input.types;
      }
      if (input.tags) {
        options.tags = input.tags;
      }
      const candidates = await context.memoryStore.search(projectId, input.query ?? "", options);
      const searchScope = input.scopes?.length === 1 ? input.scopes[0] : undefined;
      return rankMemories(candidates, input.query ?? "", "search", undefined, searchScope)
        .slice(0, limit)
        .map((scored) => scored.entry);
    },

    configureGitHubTeamMode: async (input: ConfigureGitHubTeamModeInput) => context.githubTeamService.configure({
      projectId: resolveProjectId(context, input.projectId),
      repository: input.repository,
    }),

    getCollaborationStatus: async (input: GetCollaborationStatusInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      const config = await context.collaborationStore.getProjectConfig(projectId);
      const proposals = await context.collaborationStore.listProposals(projectId);
      const counts = proposalCounts(proposals);
      const retries = proposals
        .filter((proposal) => proposal.state === "sync_failed" && proposal.retry.nextAttemptAt !== undefined)
        .map((proposal) => ({ memoryId: proposal.memory.id, attempts: proposal.retry.attempts, nextAttemptAt: proposal.retry.nextAttemptAt as string }));
      return config === undefined
        ? { mode: "local_private" as const, proposals: counts, retries }
        : { mode: config.mode, repository: config.repository, proposals: counts, retries };
    },

    listMemoryCandidates: async (input: ListMemoryCandidatesInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      const candidates = await context.pendingCandidateStore.list(projectId);
      return candidates
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit ?? 50);
    },

    approveMemoryCandidate: async (input: ApproveMemoryCandidateInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      return approveCandidateInGitHubMode(context, projectId, input.candidateId);
    },

    rejectMemoryCandidate: async (input: RejectMemoryCandidateInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      await context.approvalService.reject(projectId, input.candidateId, input.reason);
      return {
        projectId,
        candidateId: input.candidateId,
        rejected: true
      };
    },

    exportStaticMemoryFiles: async (input: ExportStaticMemoryFilesInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      await context.githubTeamService.refreshBeforeRetrieval(projectId);
      const memories = await context.memoryStore.list(projectId);
      const outputDir = resolve(context.projectRoot, input.outputDir ?? ".");

      const request = {
        projectId,
        memories,
        outputDir
      };
      if (input.targets) {
        Object.assign(request, { targets: input.targets });
      }
      if (input.includeConfidential !== undefined) {
        Object.assign(request, { includeConfidential: input.includeConfidential });
      }

      return context.exportService.write(request);
    },

    getDiagnostics: async (input: GetDiagnosticsInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      const query = {
        limit: input.limit ?? 100
      };
      if (input.severity) {
        Object.assign(query, { severity: input.severity });
      }
      if (input.code) {
        Object.assign(query, { code: input.code });
      }
      return context.diagnosticsLogStore.list(projectId, query);
    },

    supersedeMemory: async (input: SupersedeMemoryInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      if (await isGitHubTeamMode(context, projectId)) {
        const existing = await context.memoryStore.findById(projectId, input.memoryId);
        if (existing === undefined) {
          throw new OpenMembraneError({
            code: "MEMORY_NOT_FOUND",
            message: `Memory ${input.memoryId} was not found.`,
            safeMessage: "The memory was not found.",
            details: { memoryId: input.memoryId },
          });
        }
        if (existing.status === "superseded") {
          throw new OpenMembraneError({
            code: "MEMORY_ALREADY_SUPERSEDED",
            message: `Memory ${input.memoryId} is already superseded.`,
            safeMessage: "The memory is already superseded.",
            details: { memoryId: input.memoryId },
          });
        }
        return { ...existing, ...await context.githubTeamService.supersedeMemory(existing) };
      }
      const superseded = await context.memoryStore.supersede(projectId, input.memoryId, input.replacementId);
      await context.auditLogStore.append({
        id: createId("audit"),
        projectId,
        type: "memory_superseded",
        entityId: input.memoryId,
        createdAt: nowIso(),
        details: {
          reason: input.reason ?? "Superseded via tool.",
          replacementId: input.replacementId
        }
      });
      return superseded;
    },

    updateMemory: async (input: UpdateMemoryInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      if (await isGitHubTeamMode(context, projectId)) {
        const { updated } = await context.updateService.preview(projectId, input.memoryId, {
          content: input.content,
          type: input.type,
          scope: input.scope,
          tags: input.tags,
        });
        return { ...updated, ...await context.githubTeamService.updateProposal(input.memoryId, updated) };
      }
      return context.updateService.update(projectId, input.memoryId, {
        content: input.content,
        type: input.type,
        scope: input.scope,
        tags: input.tags
      });
    },

    listAuditLog: async (input: ListAuditLogInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      const events = await context.auditLogStore.list(projectId);
      return events.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, input.limit ?? 100);
    },

    approveAllCandidates: async (input: ApproveAllCandidatesInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      if (!await isGitHubTeamMode(context, projectId)) return context.approvalService.approveAll(projectId);
      const candidates = await context.pendingCandidateStore.list(projectId);
      const approved: unknown[] = [];
      const skipped: Array<{ candidateId: string; reason: string }> = [];
      for (const candidate of candidates) {
        try {
          approved.push(await approveCandidateInGitHubMode(context, projectId, candidate.id));
        } catch (error) {
          if (error instanceof OpenMembraneError && (error.code === "CANDIDATE_NOT_FOUND" || error.code === "SECRET_CANDIDATE")) {
            skipped.push({ candidateId: candidate.id, reason: error.safeMessage });
          } else {
            throw error;
          }
        }
      }
      return { projectId, approved, skipped };
    },

    rejectAllCandidates: async (input: RejectAllCandidatesInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      return context.approvalService.rejectAll(projectId, input.reason);
    },

    remember: async (input: RememberInput) => {
      const projectId = resolveProjectId(context, input.projectId);

      // Normalize single vs batch
      let items: RememberItemInput[];
      if (input.items && input.items.length > 0) {
        items = input.items;
      } else if (input.content && input.type) {
        items = [{
          content: input.content,
          type: input.type,
          scope: input.scope,
          confidence: input.confidence,
          tags: input.tags
        }];
      } else {
        throw new OpenMembraneError({
          code: "VALIDATION_ERROR",
          message: "Either content+type or items[] is required.",
          safeMessage: "Provide content and type for a single memory, or items[] for batch."
        });
      }

      const secretDetector = new SecretDetector();
      const redactions: SecretFinding[] = [];
      const candidates: MemoryCandidate[] = items.map((item) => {
        const { redactedText, findings } = secretDetector.redact(item.content);
        redactions.push(...findings);
        return {
          id: createId("cand"),
          projectId,
          type: item.type,
          content: redactedText,
          scope: item.scope ?? "unknown",
          confidence: item.confidence ?? "medium",
          sensitivity: "internal" as const,
          source: { kind: "manual" as const },
          reason: "Direct AI-side extraction via remember tool.",
          recommendedAction: "auto_save" as const,
          tags: item.tags ?? [],
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
      });

      const result = await context.pipeline.processStructured(projectId, candidates, {
        preserveExistingConflicts: await isGitHubTeamMode(context, projectId),
      });
      return publishAcceptedInGitHubMode(context, projectId, mapPipelineResult({ ...result, redactions }));
    },

    reviewStaleMemories: async (input: ReviewStaleMemoriesInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      const months = input.staleAfterMonths ?? 6;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffIso = cutoff.toISOString();

      await context.githubTeamService.refreshBeforeRetrieval(projectId);
      const memories = await context.memoryStore.list(projectId);
      return memories
        .filter((memory) => memory.updatedAt < cutoffIso)
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    }
  };
}

type GitHubModeIngestionResult = IngestionResult & {
  proposalCount?: number;
  proposals?: Array<{ memoryId: string; state: string; nextAttemptAt?: string }>;
};

async function publishAcceptedInGitHubMode(
  context: OpenMembraneMcpContext,
  projectId: string,
  result: IngestionResult,
): Promise<GitHubModeIngestionResult> {
  if (!await isGitHubTeamMode(context, projectId) || result.saved.length === 0) return result;

  const proposals: Array<{ memoryId: string; state: string; nextAttemptAt?: string }> = [];
  for (const saved of result.saved) {
    const memory = await context.memoryStore.findById(projectId, saved.id);
    if (memory === undefined) continue;
    const publication = await context.githubTeamService.publishAcceptedMemory(memory, saved.replaces ?? []);
    await context.memoryStore.supersede(projectId, memory.id);
    await recordGitHubProposalStaging(context, projectId, memory.id);
    proposals.push(publicationSummary(memory.id, publication));
  }
  return { ...result, savedCount: 0, saved: [], proposalCount: proposals.length, proposals };
}

async function approveCandidateInGitHubMode(
  context: OpenMembraneMcpContext,
  projectId: string,
  candidateId: string,
): Promise<MemoryEntry | (MemoryEntry & PublishAcceptedMemoryResult)> {
  const candidate = await context.pendingCandidateStore.findById(projectId, candidateId);
  const memory = await context.approvalService.approve(projectId, candidateId, {
    preserveExistingConflicts: await isGitHubTeamMode(context, projectId),
  });
  if (!await isGitHubTeamMode(context, projectId)) return memory;
  if (candidate === undefined || memory.id !== candidate.id.replace(/^cand_/, "mem_")) return memory;
  const publication = await context.githubTeamService.publishAcceptedMemory(memory, candidate.conflictWith ?? []);
  await context.memoryStore.supersede(projectId, memory.id);
  await recordGitHubProposalStaging(context, projectId, memory.id);
  return { ...memory, ...publication };
}

async function recordGitHubProposalStaging(
  context: OpenMembraneMcpContext,
  projectId: string,
  memoryId: string,
): Promise<void> {
  try {
    await context.auditLogStore.append({
      id: createId("audit"),
      projectId,
      type: "memory_proposed",
      entityId: memoryId,
      createdAt: nowIso(),
      details: { mode: "github_team", staging: "proposal" },
    });
  } catch {
    // Proposal state has already been persisted, so audit failure must not orphan it.
  }
}

function publicationSummary(
  memoryId: string,
  result: Awaited<ReturnType<OpenMembraneMcpContext["githubTeamService"]["publishAcceptedMemory"]>>,
): { memoryId: string; state: string; nextAttemptAt?: string } {
  if (result.kind === "published") return { memoryId, state: result.proposal.state };
  if (result.kind === "retry_scheduled" || result.kind === "retry_deferred") {
    return { memoryId, state: result.kind, nextAttemptAt: result.nextAttemptAt };
  }
  return { memoryId, state: "rejected" };
}

async function isGitHubTeamMode(context: OpenMembraneMcpContext, projectId: string): Promise<boolean> {
  return (await context.collaborationStore.getProjectConfig(projectId))?.mode === "github_team";
}

function proposalCounts(proposals: readonly CollaborationProposal[]): {
  proposed: number;
  active: number;
  rejected: number;
  syncFailed: number;
  conflict: number;
} {
  return proposals.reduce((counts, proposal) => {
    if (proposal.state === "proposed") counts.proposed += 1;
    if (proposal.state === "active") counts.active += 1;
    if (proposal.state === "rejected") counts.rejected += 1;
    if (proposal.state === "sync_failed") counts.syncFailed += 1;
    if (proposal.state === "conflict") counts.conflict += 1;
    return counts;
  }, { proposed: 0, active: 0, rejected: 0, syncFailed: 0, conflict: 0 });
}
