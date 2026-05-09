import type {
  Confidence,
  MemoryCandidate,
  MemoryScope,
  MemorySource,
  MemoryType,
  Sensitivity
} from "./MemoryCandidate";

export const memoryStatuses = ["active", "superseded"] as const;
export type MemoryStatus = (typeof memoryStatuses)[number];

export interface MemoryEntry {
  id: string;
  projectId: string;
  type: MemoryType;
  content: string;
  scope: MemoryScope;
  confidence: Confidence;
  sensitivity: Exclude<Sensitivity, "secret">;
  source: MemorySource;
  reason: string;
  tags: string[];
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  supersededBy?: string;
  supersededAt?: string;
}

export function memoryEntryFromCandidate(candidate: MemoryCandidate, approvedAt: string): MemoryEntry {
  if (candidate.sensitivity === "secret") {
    throw new Error("Secret candidates cannot be converted to saved memory entries.");
  }

  return {
    id: candidate.id.replace(/^cand_/, "mem_"),
    projectId: candidate.projectId,
    type: candidate.type,
    content: candidate.content,
    scope: candidate.scope,
    confidence: candidate.confidence,
    sensitivity: candidate.sensitivity,
    source: candidate.source,
    reason: candidate.reason,
    tags: candidate.tags,
    status: "active",
    createdAt: candidate.createdAt,
    updatedAt: approvedAt,
    approvedAt
  };
}
