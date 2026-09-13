import type { MemoryPipelineResult } from "../pipeline/MemoryPipeline";
import type { MemoryType, MemoryScope, RecommendedAction } from "../types/MemoryCandidate";

export interface IngestionSavedEntry {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  content: string;
  replaces?: string[];
}

export interface IngestionPendingCandidate {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  content: string;
  recommendedAction: RecommendedAction;
  conflictWith?: string[];
}

export interface IngestionRejectedCandidate {
  id: string;
  type: MemoryType;
  rejectionReason?: string;
  duplicateOf?: string;
}

export interface IngestionSupersededEntry {
  id: string;
  supersededBy?: string;
}

export interface IngestionResult {
  projectId: string;
  savedCount: number;
  pendingCount: number;
  rejectedCount: number;
  supersededCount: number;
  redactionCount: number;
  saved: IngestionSavedEntry[];
  pending: IngestionPendingCandidate[];
  rejected: IngestionRejectedCandidate[];
  superseded: IngestionSupersededEntry[];
}

export function mapPipelineResult(result: MemoryPipelineResult): IngestionResult {
  return {
    projectId: result.projectId,
    savedCount: result.saved.length,
    pendingCount: result.pending.length,
    rejectedCount: result.rejected.length,
    supersededCount: result.superseded.length,
    redactionCount: result.redactions.length,
    saved: result.saved.map((entry) => {
      const candidate = result.candidates.find((item) => item.id.replace(/^cand_/, "mem_") === entry.id);
      return {
        id: entry.id,
        type: entry.type,
        scope: entry.scope,
        content: entry.content,
        ...(candidate?.conflictWith === undefined ? {} : { replaces: candidate.conflictWith }),
      };
    }),
    pending: result.pending.map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      scope: candidate.scope,
      content: candidate.content,
      recommendedAction: candidate.recommendedAction,
      ...(candidate.conflictWith ? { conflictWith: candidate.conflictWith } : {})
    })),
    rejected: result.rejected.map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      ...(candidate.rejectionReason ? { rejectionReason: candidate.rejectionReason } : {}),
      ...(candidate.duplicateOf ? { duplicateOf: candidate.duplicateOf } : {})
    })),
    superseded: result.superseded.map((entry) => ({
      id: entry.id,
      ...(entry.supersededBy ? { supersededBy: entry.supersededBy } : {})
    }))
  };
}
