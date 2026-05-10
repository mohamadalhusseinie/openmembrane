import { resolve } from "node:path";
import { OpenMembrainError, type DiagnosticSeverity, type MemoryScope, type MemorySearchOptions, type MemoryType, type SessionInput } from "@openmembrain/core";
import type { ExportTarget } from "@openmembrain/exporters";
import type { OpenMembrainMcpContext } from "../context";
import { createId, nowIso } from "@openmembrain/shared";
import { resolveProjectId } from "../context";

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

export interface ReviewStaleMemoriesInput extends ProjectScopedInput {
  staleAfterMonths?: number | undefined;
}

export function createToolHandlers(context: OpenMembrainMcpContext) {
  return {
    proposeMemoryFromSession: async (input: ProposeMemoryInput) => {
      if (!input.transcript && !input.summary) {
        throw new OpenMembrainError({
          code: "VALIDATION_ERROR",
          message: "Either transcript or summary is required.",
          safeMessage: "Either a session transcript or summary is required."
        });
      }

      const sessionInput: SessionInput = {
        projectId: resolveProjectId(context, input.projectId)
      };
      if (input.transcript) {
        sessionInput.transcript = input.transcript;
      }
      if (input.summary) {
        sessionInput.summary = input.summary;
      }
      if (input.tool) {
        sessionInput.tool = input.tool;
      }
      if (input.sessionId) {
        sessionInput.sessionId = input.sessionId;
      }
      if (input.metadata) {
        sessionInput.metadata = input.metadata;
      }

      return context.pipeline.process(sessionInput);
    },

    getProjectRules: async (input: GetProjectRulesInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      const options: MemorySearchOptions = {
        limit: input.limit ?? 50,
        types: ruleTypes
      };
      if (input.scope) {
        options.scopes = [input.scope];
      }
      return context.memoryStore.search(projectId, "", options);
    },

    getRelevantContext: async (input: GetRelevantContextInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      const options: MemorySearchOptions = {
        limit: input.limit ?? 10
      };
      if (input.scope) {
        options.scopes = [input.scope];
      }
      return context.memoryStore.search(projectId, input.query, options);
    },

    searchMemory: async (input: SearchMemoryInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      const options: MemorySearchOptions = {
        limit: input.limit ?? 20
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
      return context.memoryStore.search(projectId, input.query ?? "", options);
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
      return context.approvalService.approve(projectId, input.candidateId);
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

    listAuditLog: async (input: ListAuditLogInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      const events = await context.auditLogStore.list(projectId);
      return events.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, input.limit ?? 100);
    },

    reviewStaleMemories: async (input: ReviewStaleMemoriesInput) => {
      const projectId = resolveProjectId(context, input.projectId);
      const months = input.staleAfterMonths ?? 6;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffIso = cutoff.toISOString();

      const memories = await context.memoryStore.list(projectId);
      return memories
        .filter((memory) => memory.updatedAt < cutoffIso)
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    }
  };
}
