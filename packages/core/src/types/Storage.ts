import type { MemoryCandidate, MemoryScope, MemoryType } from "./MemoryCandidate";
import type { MemoryEntry } from "./MemoryEntry";
export type { DiagnosticEvent, DiagnosticQuery, DiagnosticsLogStore } from "../diagnostics/Diagnostics";

export interface MemorySearchOptions {
  limit?: number;
  scopes?: MemoryScope[];
  types?: MemoryType[];
  tags?: string[];
}

export interface MemoryStore {
  list(projectId: string): Promise<MemoryEntry[]>;
  findById(projectId: string, memoryId: string): Promise<MemoryEntry | undefined>;
  save(entry: MemoryEntry): Promise<MemoryEntry>;
  supersede(projectId: string, memoryId: string, supersededBy?: string): Promise<MemoryEntry>;
  search(projectId: string, query: string, options?: MemorySearchOptions): Promise<MemoryEntry[]>;
}

export interface PendingCandidateStore {
  list(projectId: string): Promise<MemoryCandidate[]>;
  findById(projectId: string, candidateId: string): Promise<MemoryCandidate | undefined>;
  save(candidate: MemoryCandidate): Promise<MemoryCandidate>;
  remove(projectId: string, candidateId: string): Promise<void>;
}

export interface AuditEvent {
  id: string;
  projectId: string;
  type:
    | "session_ingested"
    | "candidate_extracted"
    | "memory_saved"
    | "candidate_queued"
    | "candidate_rejected"
    | "memory_superseded"
    | "memory_updated";
  entityId?: string;
  createdAt: string;
  details?: Record<string, unknown>;
}

export interface AuditLogStore {
  append(event: AuditEvent): Promise<void>;
  list(projectId: string): Promise<AuditEvent[]>;
}
