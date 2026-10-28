import { createId, nowIso } from "@openmembrane/shared";
import { OpenMembraneError } from "../errors/OpenMembraneError";
import { SecretDetector } from "../filtering/SecretDetector";
import type { MemoryCandidate } from "../types/MemoryCandidate";
import { inferRelationships, type RelationshipInferenceOptions, type Supersession } from "./RelationshipInference";
import type { AuditEvent, AuditLogStore, DiagnosticsLogStore, MemoryStore, PendingCandidateStore } from "../types/Storage";
import {
  relationshipKey,
  systemRelationshipId,
  validateEntityRef,
  validateRelationship,
  type EntityRef,
  type EntityKind,
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
  diagnosticsLogStore: DiagnosticsLogStore;
}

interface RelationshipSnapshot {
  candidates: MemoryCandidate[];
  audit: AuditEvent[];
  evidence: Relationship[];
  diagnosticIds: Set<string>;
}

export class RelationshipService {
  private readonly relationshipStore: RelationshipStore;
  private readonly memoryStore: MemoryStore;
  private readonly pendingCandidateStore: PendingCandidateStore;
  private readonly auditLogStore: AuditLogStore;
  private readonly diagnosticsLogStore: DiagnosticsLogStore;
  private readonly secretDetector = new SecretDetector();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: RelationshipServiceOptions) {
    this.relationshipStore = options.relationshipStore;
    this.memoryStore = options.memoryStore;
    this.pendingCandidateStore = options.pendingCandidateStore;
    this.auditLogStore = options.auditLogStore;
    this.diagnosticsLogStore = options.diagnosticsLogStore;
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
    const snapshot = await this.snapshot(projectId);
    const eligible = await this.eligibleEntities(projectId, [input.source, input.target], snapshot);
    this.assertEntityExists(input.source, eligible);
    this.assertEntityExists(input.target, eligible);

    const now = nowIso();
    const evidence = snapshot.evidence;
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
      const snapshot = await this.snapshot(projectId);
      const { candidates, audit } = snapshot;
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
      return this.replaceSystemRelationshipsUnlocked(projectId, "derived", drafts, snapshot);
    });
  }

  /** Recomputes inferred relationships locally from approved signals and persists them with rationale and confidence. */
  syncInferred(projectId: string, options?: RelationshipInferenceOptions): Promise<Relationship[]> {
    return this.serialize(async () => {
      const snapshot = await this.snapshot(projectId);
      const supersessions = supersessionEvents(snapshot.audit);
      const memories = await this.memoryStore.list(projectId, { includeSuperseded: true });
      const drafts = inferRelationships({ memories, candidates: snapshot.candidates, supersessions }, options);
      return this.replaceSystemRelationshipsUnlocked(projectId, "inferred", drafts, snapshot);
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
    snapshot?: RelationshipSnapshot,
  ): Promise<Relationship[]> {
    snapshot ??= await this.snapshot(projectId);
    const refs = drafts.flatMap((draft) => [draft.source, draft.target]);
    for (const ref of refs) validateEntityRef(ref, "endpoint");
    const eligible = await this.eligibleEntities(projectId, refs, snapshot);
    const now = nowIso();
    const existing = new Map(snapshot.evidence.filter((item) => item.origin === origin).map((item) => [item.id, item]));
    const wanted = new Set<string>();
    const pending: Array<{ relationship: Relationship; previous: Relationship | undefined }> = [];
    for (const draft of drafts) {
      if (
        !this.isEndpointEligible(draft.source, eligible) ||
        !this.isEndpointEligible(draft.target, eligible)
      ) continue;
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
      pending.push({ relationship, previous });
    }
    // Every record is validated before the first write so an invalid draft cannot leave a partial refresh.
    const saved: Relationship[] = [];
    for (const { relationship, previous } of pending) {
      if (previous && previous.status === "active" && previous.confidence === relationship.confidence && previous.rationale === relationship.rationale) {
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

  private async snapshot(projectId: string): Promise<RelationshipSnapshot> {
    const [candidates, audit, evidence, diagnostics] = await Promise.all([
      this.pendingCandidateStore.list(projectId),
      this.auditLogStore.list(projectId),
      this.listEvidence(projectId),
      this.diagnosticsLogStore.list(projectId, { limit: Number.MAX_SAFE_INTEGER }),
    ]);
    return { candidates, audit, evidence, diagnosticIds: new Set(diagnostics.map((event) => event.id)) };
  }

  private async eligibleEntities(
    projectId: string,
    refs: EntityRef[],
    snapshot: RelationshipSnapshot,
  ): Promise<Partial<Record<EntityKind, Set<string>>>> {
    const memoryIds = new Set(refs.filter((ref) => ref.kind === "memory").map((ref) => ref.id));
    // list() omits superseded memories, which are still valid graph endpoints.
    const memories = await Promise.all([...memoryIds].map((id) => this.memoryStore.findById(projectId, id)));
    const candidateIds = new Set<string>();
    for (const duplicate of duplicateRejections(snapshot.audit)) {
      candidateIds.add(duplicate.candidateId);
      if (duplicate.duplicateOf.startsWith("cand_")) candidateIds.add(duplicate.duplicateOf);
    }
    // Durable duplicate audit evidence survives queue removal; relationships alone do not prove eligibility.
    for (const candidate of snapshot.candidates) {
      if (this.isSecretCandidate(candidate)) candidateIds.delete(candidate.id);
      else candidateIds.add(candidate.id);
    }
    return {
      memory: new Set(memories.filter((memory) => memory !== undefined).map((memory) => memory.id)),
      candidate: candidateIds,
      audit_event: new Set(snapshot.audit.map((event) => event.id)),
      diagnostic: snapshot.diagnosticIds,
    };
  }

  private isEndpointEligible(ref: EntityRef, eligible: Partial<Record<EntityKind, Set<string>>>): boolean {
    // Tags and sessions are virtual groupings, not independently persisted entities.
    if (ref.kind === "tag" || ref.kind === "session") return true;
    return eligible[ref.kind]?.has(ref.id) === true;
  }

  /** Serializes read-modify-write sequences so concurrent callers cannot interleave. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private assertEntityExists(ref: EntityRef, eligible: Partial<Record<EntityKind, Set<string>>>): void {
    if (this.isEndpointEligible(ref, eligible)) return;
    if (ref.kind === "memory") {
      throw new OpenMembraneError({ code: "MEMORY_NOT_FOUND", message: `Memory ${ref.id} not found.`, safeMessage: "That memory does not exist." });
    }
    if (ref.kind === "candidate") {
      throw new OpenMembraneError({ code: "CANDIDATE_NOT_FOUND", message: `Candidate ${ref.id} not found.`, safeMessage: "That candidate does not exist." });
    }
    throw new OpenMembraneError({ code: "VALIDATION_ERROR", message: "That relationship endpoint does not exist in this project." });
  }

  private isSecretCandidate(candidate: MemoryCandidate): boolean {
    return candidate.sensitivity === "secret" || this.secretDetector.containsSecret(candidate.content);
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

/** Pipeline events record `supersededBy`; the public supersede operation records `replacementId`. */
function supersessionEvents(audit: AuditEvent[]): Supersession[] {
  const supersessions: Supersession[] = [];
  for (const event of audit) {
    const replacement = event.details?.supersededBy ?? event.details?.replacementId;
    if (event.type === "memory_superseded" && event.entityId && typeof replacement === "string" && replacement) {
      supersessions.push({ supersededId: event.entityId, supersededBy: replacement });
    }
  }
  return supersessions;
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