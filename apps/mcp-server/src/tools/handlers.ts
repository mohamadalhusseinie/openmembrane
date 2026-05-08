import { resolve } from "node:path";
import type { MemoryScope, MemorySearchOptions, MemoryType, SessionInput } from "@openmembrain/core";
import type { ExportTarget } from "@openmembrain/exporters";
import type { OpenMembrainMcpContext } from "../context";
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
  projectId?: string;
}

export interface ProposeMemoryInput extends ProjectScopedInput {
  transcript?: string;
  summary?: string;
  tool?: string;
  sessionId?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface GetProjectRulesInput extends ProjectScopedInput {
  scope?: MemoryScope;
  limit?: number;
}

export interface GetRelevantContextInput extends ProjectScopedInput {
  query: string;
  scope?: MemoryScope;
  limit?: number;
}

export interface SearchMemoryInput extends ProjectScopedInput {
  query?: string;
  scopes?: MemoryScope[];
  types?: MemoryType[];
  tags?: string[];
  limit?: number;
}

export interface ListMemoryCandidatesInput extends ProjectScopedInput {
  limit?: number;
}

export interface ApproveMemoryCandidateInput extends ProjectScopedInput {
  candidateId: string;
}

export interface RejectMemoryCandidateInput extends ProjectScopedInput {
  candidateId: string;
  reason?: string;
}

export interface ExportStaticMemoryFilesInput extends ProjectScopedInput {
  targets?: ExportTarget[];
  outputDir?: string;
  includeConfidential?: boolean;
}

export function createToolHandlers(context: OpenMembrainMcpContext) {
  return {
    proposeMemoryFromSession: async (input: ProposeMemoryInput) => {
      if (!input.transcript && !input.summary) {
        throw new Error("Either transcript or summary is required.");
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
    }
  };
}
