import { createId, nowIso } from "@openmembrain/shared";
import { ActionRecommender } from "../classification/ActionRecommender";
import { MemoryClassifier } from "../classification/MemoryClassifier";
import { ConflictDetector } from "../deduplication/ConflictDetector";
import { Deduplicator } from "../deduplication/Deduplicator";
import type { MemoryExtractor } from "../extraction/MemoryExtractor";
import { PolicyEngine } from "../policy/PolicyEngine";
import type { MemoryCandidate } from "../types/MemoryCandidate";
import { memoryEntryFromCandidate, type MemoryEntry } from "../types/MemoryEntry";
import type { AuditLogStore, MemoryStore, PendingCandidateStore } from "../types/Storage";
import { SessionIngestor } from "./SessionIngestor";
import type { SessionInput } from "../types/SessionInput";
import type { SecretFinding } from "../filtering/SecretDetector";

export interface MemoryPipelineOptions {
  extractor: MemoryExtractor;
  memoryStore: MemoryStore;
  pendingCandidateStore: PendingCandidateStore;
  auditLogStore: AuditLogStore;
  ingestor?: SessionIngestor;
  classifier?: MemoryClassifier;
  policyEngine?: PolicyEngine;
  deduplicator?: Deduplicator;
  conflictDetector?: ConflictDetector;
  actionRecommender?: ActionRecommender;
}

export interface MemoryPipelineResult {
  projectId: string;
  candidates: MemoryCandidate[];
  saved: MemoryEntry[];
  pending: MemoryCandidate[];
  rejected: MemoryCandidate[];
  redactions: SecretFinding[];
}

export class MemoryPipeline {
  private readonly extractor: MemoryExtractor;
  private readonly memoryStore: MemoryStore;
  private readonly pendingCandidateStore: PendingCandidateStore;
  private readonly auditLogStore: AuditLogStore;
  private readonly ingestor: SessionIngestor;
  private readonly classifier: MemoryClassifier;
  private readonly policyEngine: PolicyEngine;
  private readonly deduplicator: Deduplicator;
  private readonly conflictDetector: ConflictDetector;
  private readonly actionRecommender: ActionRecommender;

  constructor(options: MemoryPipelineOptions) {
    this.extractor = options.extractor;
    this.memoryStore = options.memoryStore;
    this.pendingCandidateStore = options.pendingCandidateStore;
    this.auditLogStore = options.auditLogStore;
    this.ingestor = options.ingestor ?? new SessionIngestor();
    this.classifier = options.classifier ?? new MemoryClassifier();
    this.policyEngine = options.policyEngine ?? new PolicyEngine();
    this.deduplicator = options.deduplicator ?? new Deduplicator();
    this.conflictDetector = options.conflictDetector ?? new ConflictDetector();
    this.actionRecommender = options.actionRecommender ?? new ActionRecommender();
  }

  async process(input: SessionInput): Promise<MemoryPipelineResult> {
    const ingested = this.ingestor.ingest(input);
    const extracted = await this.extractor.extract(ingested.input);
    const existing = await this.memoryStore.list(input.projectId);
    const pendingCandidates: MemoryCandidate[] = await this.pendingCandidateStore.list(input.projectId);
    const saved: MemoryEntry[] = [];
    const pending: MemoryCandidate[] = [];
    const rejected: MemoryCandidate[] = [];
    const candidates: MemoryCandidate[] = [];

    await this.auditLogStore.append({
      id: createId("audit"),
      projectId: input.projectId,
      type: "session_ingested",
      createdAt: nowIso(),
      details: {
        redactionCount: ingested.redactions.length,
        transcriptHash: ingested.transcriptHash
      }
    });

    for (const rawCandidate of extracted) {
      await this.auditLogStore.append({
        id: createId("audit"),
        projectId: input.projectId,
        type: "candidate_extracted",
        entityId: rawCandidate.id,
        createdAt: nowIso(),
        details: { type: rawCandidate.type }
      });

      let candidate = this.withTranscriptHash(this.classifier.classify(rawCandidate), ingested.transcriptHash);
      const policyCheck = this.policyEngine.evaluate(candidate);
      candidate = {
        ...candidate,
        sensitivity: policyCheck.sensitivity
      };

      if (!policyCheck.allowed) {
        const rejectedCandidate = this.reject(candidate, policyCheck.violations.join(" "));
        rejected.push(rejectedCandidate);
        candidates.push(rejectedCandidate);
        await this.auditRejected(rejectedCandidate);
        continue;
      }

      const duplicate = this.deduplicator.findDuplicate(candidate, [...existing, ...saved, ...pendingCandidates]);
      if (duplicate) {
        const rejectedCandidate = this.reject(
          {
            ...candidate,
            duplicateOf: duplicate.id
          },
          "Duplicate memory already exists."
        );
        rejected.push(rejectedCandidate);
        candidates.push(rejectedCandidate);
        await this.auditRejected(rejectedCandidate);
        continue;
      }

      const conflicts = this.conflictDetector.findConflicts(candidate, [...existing, ...saved]);
      if (conflicts.length > 0) {
        candidate = {
          ...candidate,
          conflictWith: conflicts.map((memory) => memory.id)
        };
      }

      const recommendedAction = this.actionRecommender.recommend(candidate, {
        hasConflict: conflicts.length > 0,
        isDuplicate: false
      });
      candidate = {
        ...candidate,
        recommendedAction,
        updatedAt: nowIso()
      };

      candidates.push(candidate);

      if (recommendedAction === "auto_save") {
        const entry = memoryEntryFromCandidate(candidate, nowIso());
        const stored = await this.memoryStore.save(entry);
        saved.push(stored);
        existing.push(stored);
        await this.auditLogStore.append({
          id: createId("audit"),
          projectId: input.projectId,
          type: "memory_saved",
          entityId: stored.id,
          createdAt: nowIso(),
          details: { candidateId: candidate.id }
        });
        continue;
      }

      if (recommendedAction === "ask_user") {
        const storedCandidate = await this.pendingCandidateStore.save(candidate);
        pending.push(storedCandidate);
        pendingCandidates.push(storedCandidate);
        await this.auditLogStore.append({
          id: createId("audit"),
          projectId: input.projectId,
          type: "candidate_queued",
          entityId: candidate.id,
          createdAt: nowIso(),
          details: { conflictWith: candidate.conflictWith ?? [] }
        });
        continue;
      }

      const rejectedCandidate = this.reject(candidate, "Rejected by recommendation policy.");
      rejected.push(rejectedCandidate);
      await this.auditRejected(rejectedCandidate);
    }

    return {
      projectId: input.projectId,
      candidates,
      saved,
      pending,
      rejected,
      redactions: ingested.redactions
    };
  }

  private withTranscriptHash(candidate: MemoryCandidate, transcriptHash: string | undefined): MemoryCandidate {
    if (!transcriptHash) {
      return candidate;
    }

    return {
      ...candidate,
      source: {
        ...candidate.source,
        transcriptHash
      }
    };
  }

  private reject(candidate: MemoryCandidate, reason: string): MemoryCandidate {
    return {
      ...candidate,
      recommendedAction: "reject",
      rejectionReason: reason,
      updatedAt: nowIso()
    };
  }

  private async auditRejected(candidate: MemoryCandidate): Promise<void> {
    await this.auditLogStore.append({
      id: createId("audit"),
      projectId: candidate.projectId,
      type: "candidate_rejected",
      entityId: candidate.id,
      createdAt: nowIso(),
      details: {
        reason: candidate.rejectionReason,
        duplicateOf: candidate.duplicateOf
      }
    });
  }
}
