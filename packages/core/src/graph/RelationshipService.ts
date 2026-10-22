import { createId, nowIso } from "@openmembrane/shared";
import { OpenMembraneError } from "../errors/OpenMembraneError";
import type { AuditLogStore, MemoryStore, PendingCandidateStore } from "../types/Storage";
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

  async createManual(projectId: string, input: CreateManualRelationshipInput): Promise<Relationship> {
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
      id: existing?.id ?? createId("rel"),
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
  async remove(projectId: string, relationshipId: string, rationale = "Removed by user."): Promise<Relationship> {
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
      id: existingManual?.id ?? createId("rel"),
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
  async syncDerived(projectId: string): Promise<Relationship[]> {
    const candidates = await this.pendingCandidateStore.list(projectId);
    const drafts: RelationshipDraft[] = [];
    for (const candidate of candidates) {
      if (candidate.sensitivity === "secret") continue;
      const source: EntityRef = { kind: "candidate", id: candidate.id };
      if (candidate.duplicateOf) {
        drafts.push({ source, target: { kind: "memory", id: candidate.duplicateOf }, type: "duplicate_of", confidence: 1, rationale: "Recorded as a duplicate during extraction." });
      }
      for (const memoryId of candidate.conflictWith ?? []) {
        drafts.push({ source, target: { kind: "memory", id: memoryId }, type: "conflicts_with", confidence: 1, rationale: "Recorded as conflicting during extraction." });
      }
    }
    return this.replaceSystemRelationships(projectId, "derived", drafts);
  }

  /** Makes the active records of one system origin match `drafts`; stale records are marked removed, never deleted. */
  async replaceSystemRelationships(
    projectId: string,
    origin: Exclude<RelationshipOrigin, "manual">,
    drafts: RelationshipDraft[],
  ): Promise<Relationship[]> {
    const now = nowIso();
    const existing = new Map((await this.listEvidence(projectId)).filter((item) => item.origin === origin).map((item) => [item.id, item]));
    const saved: Relationship[] = [];
    const wanted = new Set<string>();
    for (const draft of drafts) {
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

  private async assertEntityExists(projectId: string, ref: EntityRef): Promise<void> {
    if (ref.kind === "memory" && !(await this.memoryStore.findById(projectId, ref.id))) {
      throw new OpenMembraneError({ code: "MEMORY_NOT_FOUND", message: `Memory ${ref.id} not found.`, safeMessage: "That memory does not exist." });
    }
    if (ref.kind === "candidate") {
      const candidate = await this.pendingCandidateStore.findById(projectId, ref.id);
      if (!candidate || candidate.sensitivity === "secret") {
        throw new OpenMembraneError({ code: "CANDIDATE_NOT_FOUND", message: `Candidate ${ref.id} not found.`, safeMessage: "That candidate does not exist." });
      }
    }
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
