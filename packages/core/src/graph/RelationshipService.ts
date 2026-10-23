import { createId, nowIso } from "@openmembrane/shared";
import { OpenMembraneError } from "../errors/OpenMembraneError";
import { SecretDetector } from "../filtering/SecretDetector";
import type { MemoryCandidate } from "../types/MemoryCandidate";
import type { AuditEvent, AuditLogStore, MemoryStore, PendingCandidateStore } from "../types/Storage";
import {
  relationshipKey,
  systemRelationshipId,
  validateEntityRef,
  validateRelationship,
  type EntityRef,
  type Relationship,
  type RelationshipOrigin,
  type RelationshipStore,
  type RelationshipType,
} from "./Relationship";

export interface RelationshipDraft {
  source: EntityRef;
  target: EntityRef;
  type: RelationshipType;
  confidence: number;
  rationale: string;
}

export interface CreateManualRelationshipInput {
  source: EntityRef;
  target: EntityRef;
  type: RelationshipType;
  rationale: string;
  confidence?: number | undefined;
}

export interface RelationshipServiceOptions {
  relationshipStore: RelationshipStore;
  memoryStore: MemoryStore;
  pendingCandidateStore: PendingCandidateStore;
  auditLogStore: AuditLogStore;
}

export class RelationshipService {
  private readonly relationshipStore: RelationshipStore;
  private readonly memoryStore: MemoryStore;
  private readonly pendingCandidateStore: PendingCandidateStore;
  private readonly auditLogStore: AuditLogStore;
  private readonly secretDetector = new SecretDetector();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: RelationshipServiceOptions) {
    this.relationshipStore = options.relationshipStore;
    this.memoryStore = options.memoryStore;
    this.pendingCandidateStore = options.pendingCandidateStore;
    this.auditLogStore = options.auditLogStore;
  }

  /** Every stored record, including removed and overridden evidence. */
  listEvidence(projectId: string): Promise<Relationship[]> {
    return this.relationshipStore.list(projectId, { includeRemoved: true });
  }

  /** Relationships after manual decisions override conflicting inferred and derived records. */
  async list(projectId: string): Promise<Relationship[]> {
    const all = await this.listEvidence(projectId);
    const manualByKey = new Map<string, Relationship>();
    for (const relationship of all) {
      if (relationship.origin === "manual") manualByKey.set(relationshipKey(relationship), relationship);
    }
    const visible: Relationship[] = [];
    const seen = new Set<string>();
    for (const relationship of all.filter((item) => item.status === "active").sort(byOriginPriority)) {
      const key = relationshipKey(relationship);
      if (relationship.origin !== "manual" && manualByKey.has(key)) continue;
      if (relationship.origin !== "manual") {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      visible.push(relationship);
    }
    return visible;
  }

  createManual(projectId: string, input: CreateManualRelationshipInput): Promise<Relationship> {
    return this.serialize(() => this.createManualUnlocked(projectId, input));
  }

  private async createManualUnlocked(projectId: string, input: CreateManualRelationshipInput): Promise<Relationship> {
    validateEntityRef(input.source, "source");
    validateEntityRef(input.target, "target");
    await this.assertEntityExists(projectId, input.source);
    await this.assertEntityExists(projectId, input.target);

    const now = nowIso();
    const evidence = await this.listEvidence(projectId);
    const key = relationshipKey(input);
    const matches = evidence.filter((item) => relationshipKey(item) === key);
    const existing = matches.find((item) => item.origin === "manual");
    const relationship: Relationship = {
      id: systemRelationshipId("manual", input),
      projectId,
      source: input.source,
      target: input.target,
      type: input.type,
      origin: "manual",
      confidence: input.confidence ?? 1,
      rationale: input.rationale,
      status: "active",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    validateRelationship(relationship);
    await this.relationshipStore.save(relationship);
    await this.audit(projectId, "relationship_created", relationship, now, matches.filter((item) => item.origin !== "manual" && item.status === "active"));
    return relationship;
  }

  /** Manual relationships are marked removed; other origins are overridden by a manual removal and kept as evidence. */
  remove(projectId: string, relationshipId: string, rationale = "Removed by user."): Promise<Relationship> {
    return this.serialize(() => this.removeUnlocked(projectId, relationshipId, rationale));
  }

  private async removeUnlocked(projectId: string, relationshipId: string, rationale: string): Promise<Relationship> {
    const target = await this.relationshipStore.findById(projectId, relationshipId);
    if (!target) {
      throw new OpenMembraneError({
        code: "VALIDATION_ERROR",
        message: `Relationship ${relationshipId} not found.`,
        safeMessage: "That relationship does not exist.",
      });
    }
    const now = nowIso();
    const key = relationshipKey(target);
    const evidence = await this.listEvidence(projectId);
    const matches = evidence.filter((item) => relationshipKey(item) === key);
    const existingManual = matches.find((item) => item.origin === "manual");
    const removed: Relationship = {
      ...(existingManual ?? target),
      id: systemRelationshipId("manual", target),
      origin: "manual",
      confidence: 1,
      rationale,
      status: "removed",
      createdAt: existingManual?.createdAt ?? now,
      updatedAt: now,
      removedAt: now,
    };
    validateRelationship(removed);
    await this.relationshipStore.save(removed);
    await this.audit(projectId, "relationship_removed", removed, now, matches.filter((item) => item.origin !== "manual" && item.status === "active"));
    return removed;
  }

  /** Projects existing duplicate and conflict metadata as derived relationships. */
  syncDerived(projectId: string): Promise<Relationship[]> {
    return this.serialize(async () => {
      const [candidates, audit] = await Promise.all([this.pendingCandidateStore.list(projectId), this.auditLogStore.list(projectId)]);
      const pendingIds = new Set(candidates.map((candidate) => candidate.id));
      const refFor = (id: string): EntityRef => ({ kind: pendingIds.has(id) || id.startsWith("cand_") ? "candidate" : "memory", id });
      const drafts: RelationshipDraft[] = [];
      for (const candidate of candidates) {
        if (this.isSecretCandidate(candidate)) continue;
        const source: EntityRef = { kind: "candidate", id: candidate.id };
        if (candidate.duplicateOf) {
          drafts.push({ source, target: refFor(candidate.duplicateOf), type: "duplicate_of", confidence: 1, rationale: "Recorded as a duplicate during extraction." });
        }
        for (const memoryId of candidate.conflictWith ?? []) {
          drafts.push({ source, target: { kind: "memory", id: memoryId }, type: "conflicts_with", confidence: 1, rationale: "Recorded as conflicting during extraction." });
        }
      }
      // The pipeline rejects duplicates without queueing them, so their metadata survives only in the audit log.
      for (const duplicate of duplicateRejections(audit)) {
        drafts.push({ source: { kind: "candidate", id: duplicate.candidateId }, target: refFor(duplicate.duplicateOf), type: "duplicate_of", confidence: 1, rationale: "Rejected as a duplicate during extraction." });
      }
      return this.replaceSystemRelationshipsUnlocked(projectId, "derived", drafts);
    });
  }

  /** Makes the active records of one system origin match `drafts`; stale records are marked removed, never deleted. */
  replaceSystemRelationships(
    projectId: string,
    origin: Exclude<RelationshipOrigin, "manual">,
    drafts: RelationshipDraft[],
  ): Promise<Relationship[]> {
    return this.serialize(() => this.replaceSystemRelationshipsUnlocked(projectId, origin, drafts));
  }

  private async replaceSystemRelationshipsUnlocked(
    projectId: string,
    origin: Exclude<RelationshipOrigin, "manual">,
    drafts: RelationshipDraft[],
  ): Promise<Relationship[]> {
    const secretCandidateIds = new Set(
      (await this.pendingCandidateStore.list(projectId)).filter((candidate) => this.isSecretCandidate(candidate)).map((candidate) => candidate.id),
    );
    const now = nowIso();
    const existing = new Map((await this.listEvidence(projectId)).filter((item) => item.origin === origin).map((item) => [item.id, item]));
    const saved: Relationship[] = [];
    const wanted = new Set<string>();
    for (const draft of drafts) {
      if ([draft.source, draft.target].some((ref) => ref.kind === "candidate" && secretCandidateIds.has(ref.id))) continue;
      const id = systemRelationshipId(origin, draft);
      if (wanted.has(id)) continue;
      wanted.add(id);
      const previous = existing.get(id);
      const relationship: Relationship = {
        id,
        projectId,
        source: draft.source,
        target: draft.target,
        type: draft.type,
        origin,
        confidence: draft.confidence,
        rationale: draft.rationale,
        status: "active",
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      validateRelationship(relationship);
      if (previous && previous.status === "active" && previous.confidence === draft.confidence && previous.rationale === draft.rationale) {
        saved.push(previous);
        continue;
      }
      saved.push(await this.relationshipStore.save(relationship));
    }
    for (const previous of existing.values()) {
      if (wanted.has(previous.id) || previous.status === "removed") continue;
      await this.relationshipStore.save({ ...previous, status: "removed", updatedAt: now, removedAt: now });
    }
    return saved;
  }

  /** Serializes read-modify-write sequences so concurrent callers cannot interleave. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async assertEntityExists(projectId: string, ref: EntityRef): Promise<void> {
    if (ref.kind === "memory" && !(await this.memoryStore.findById(projectId, ref.id))) {
      throw new OpenMembraneError({ code: "MEMORY_NOT_FOUND", message: `Memory ${ref.id} not found.`, safeMessage: "That memory does not exist." });
    }
    if (ref.kind === "candidate") {
      const candidate = await this.pendingCandidateStore.findById(projectId, ref.id);
      if (candidate ? this.isSecretCandidate(candidate) : !(await this.isHistoricalCandidate(projectId, ref.id))) {
        throw new OpenMembraneError({ code: "CANDIDATE_NOT_FOUND", message: `Candidate ${ref.id} not found.`, safeMessage: "That candidate does not exist." });
      }
    }
  }

  private isSecretCandidate(candidate: MemoryCandidate): boolean {
    return candidate.sensitivity === "secret" || this.secretDetector.containsSecret(candidate.content);
  }

  /** Candidates that left the pending queue stay referenceable when a non-secret duplicate rejection or existing relationship names them. */
  private async isHistoricalCandidate(projectId: string, candidateId: string): Promise<boolean> {
    const [audit, evidence] = await Promise.all([this.auditLogStore.list(projectId), this.listEvidence(projectId)]);
    return (
      duplicateRejections(audit).some((duplicate) => duplicate.candidateId === candidateId) ||
      evidence.some((item) => [item.source, item.target].some((ref) => ref.kind === "candidate" && ref.id === candidateId))
    );
  }
  private audit(projectId: string, type: "relationship_created" | "relationship_removed", relationship: Relationship, createdAt: string, overridden: Relationship[]): Promise<void> {
    return this.auditLogStore.append({
      id: createId("audit"),
      projectId,
      type,
      entityId: relationship.id,
      createdAt,
      details: {
        relationshipType: relationship.type,
        source: relationship.source,
        target: relationship.target,
        overriddenRelationshipIds: overridden.map((item) => item.id),
      },
    });
  }
}

const originPriority: Record<RelationshipOrigin, number> = { manual: 0, derived: 1, inferred: 2 };

function byOriginPriority(left: Relationship, right: Relationship): number {
  return originPriority[left.origin] - originPriority[right.origin];
}

function duplicateRejections(audit: AuditEvent[]): Array<{ candidateId: string; duplicateOf: string }> {
  const rejections: Array<{ candidateId: string; duplicateOf: string }> = [];
  for (const event of audit) {
    const duplicateOf = event.details?.duplicateOf;
    if (event.type === "candidate_rejected" && event.entityId && typeof duplicateOf === "string") {
      rejections.push({ candidateId: event.entityId, duplicateOf });
    }
  }
  return rejections;
}