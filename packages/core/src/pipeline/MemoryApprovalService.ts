import { createId, nowIso } from "@openmembrain/shared";
import { Deduplicator } from "../deduplication/Deduplicator";
import { OpenMembrainError } from "../errors/OpenMembrainError";
import { SecretDetector } from "../filtering/SecretDetector";
import { memoryEntryFromCandidate, type MemoryEntry } from "../types/MemoryEntry";
import type { AuditLogStore, MemoryStore, PendingCandidateStore } from "../types/Storage";

export interface MemoryApprovalServiceOptions {
  memoryStore: MemoryStore;
  pendingCandidateStore: PendingCandidateStore;
  auditLogStore: AuditLogStore;
  secretDetector?: SecretDetector;
  deduplicator?: Deduplicator;
}

export interface BatchApproveResult {
  projectId: string;
  approved: MemoryEntry[];
  skipped: Array<{ candidateId: string; reason: string }>;
}

export interface BatchRejectResult {
  projectId: string;
  rejectedCount: number;
}

export class MemoryApprovalService {
  private readonly memoryStore: MemoryStore;
  private readonly pendingCandidateStore: PendingCandidateStore;
  private readonly auditLogStore: AuditLogStore;
  private readonly secretDetector: SecretDetector;
  private readonly deduplicator: Deduplicator;

  constructor(options: MemoryApprovalServiceOptions) {
    this.memoryStore = options.memoryStore;
    this.pendingCandidateStore = options.pendingCandidateStore;
    this.auditLogStore = options.auditLogStore;
    this.secretDetector = options.secretDetector ?? new SecretDetector();
    this.deduplicator = options.deduplicator ?? new Deduplicator();
  }

  async approve(projectId: string, candidateId: string): Promise<MemoryEntry> {
    const candidate = await this.pendingCandidateStore.findById(projectId, candidateId);
    if (!candidate) {
      throw new OpenMembrainError({
        code: "CANDIDATE_NOT_FOUND",
        message: `Pending memory candidate ${candidateId} was not found.`,
        safeMessage: "The pending memory candidate was not found.",
        details: { candidateId }
      });
    }

    if (candidate.sensitivity === "secret" || this.secretDetector.containsSecret(candidate.content)) {
      throw new OpenMembrainError({
        code: "SECRET_CANDIDATE",
        message: "Secret candidates cannot be approved.",
        safeMessage: "This memory candidate contains secret material and cannot be approved.",
        details: { candidateId }
      });
    }

    const existing = await this.memoryStore.list(projectId);
    const duplicate = this.deduplicator.findDuplicate(candidate, existing);
    if (duplicate) {
      await this.pendingCandidateStore.remove(projectId, candidateId);
      return duplicate;
    }

    const approvedAt = nowIso();
    const memory = await this.memoryStore.save(memoryEntryFromCandidate(candidate, approvedAt));
    await this.pendingCandidateStore.remove(projectId, candidateId);
    await this.auditLogStore.append({
      id: createId("audit"),
      projectId,
      type: "memory_saved",
      entityId: memory.id,
      createdAt: approvedAt,
      details: {
        candidateId,
        approvedManually: true
      }
    });

    if (candidate.conflictWith && candidate.conflictWith.length > 0) {
      for (const conflictId of candidate.conflictWith) {
        try {
          await this.memoryStore.supersede(projectId, conflictId, memory.id);
          await this.auditLogStore.append({
            id: createId("audit"),
            projectId,
            type: "memory_superseded",
            entityId: conflictId,
            createdAt: nowIso(),
            details: { supersededBy: memory.id, reason: "Superseded by approved candidate." }
          });
        } catch {
          // Conflicting memory may already be superseded or removed — skip silently.
        }
      }
    }

    return memory;
  }

  async approveAll(projectId: string): Promise<BatchApproveResult> {
    const candidates = await this.pendingCandidateStore.list(projectId);
    const approved: MemoryEntry[] = [];
    const skipped: Array<{ candidateId: string; reason: string }> = [];

    const skippableCodes = new Set(["CANDIDATE_NOT_FOUND", "SECRET_CANDIDATE"]);

    for (const candidate of candidates) {
      try {
        const memory = await this.approve(projectId, candidate.id);
        approved.push(memory);
      } catch (error) {
        if (error instanceof OpenMembrainError && skippableCodes.has(error.code)) {
          skipped.push({ candidateId: candidate.id, reason: error.safeMessage });
        } else {
          throw error;
        }
      }
    }

    return { projectId, approved, skipped };
  }

  async rejectAll(projectId: string, reason?: string): Promise<BatchRejectResult> {
    const candidates = await this.pendingCandidateStore.list(projectId);
    for (const candidate of candidates) {
      await this.reject(projectId, candidate.id, reason);
    }
    return { projectId, rejectedCount: candidates.length };
  }

  async reject(projectId: string, candidateId: string, reason?: string): Promise<void> {
    const candidate = await this.pendingCandidateStore.findById(projectId, candidateId);
    if (!candidate) {
      throw new OpenMembrainError({
        code: "CANDIDATE_NOT_FOUND",
        message: `Pending memory candidate ${candidateId} was not found.`,
        safeMessage: "The pending memory candidate was not found.",
        details: { candidateId }
      });
    }

    await this.pendingCandidateStore.remove(projectId, candidateId);
    await this.auditLogStore.append({
      id: createId("audit"),
      projectId,
      type: "candidate_rejected",
      entityId: candidateId,
      createdAt: nowIso(),
      details: {
        reason: reason ?? "Rejected by user."
      }
    });
  }
}
