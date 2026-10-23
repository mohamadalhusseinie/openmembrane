import { createHash } from "node:crypto";
import { OpenMembraneError } from "../errors/OpenMembraneError";
import { SecretDetector } from "../filtering/SecretDetector";

export const entityKinds = ["memory", "candidate", "audit_event", "diagnostic", "session", "tag"] as const;
export type EntityKind = (typeof entityKinds)[number];

export const relationshipTypes = [
  "related_to",
  "supports",
  "depends_on",
  "conflicts_with",
  "duplicate_of",
  "supersedes",
  "derived_from",
  "tagged_with",
] as const;
export type RelationshipType = (typeof relationshipTypes)[number];

export const relationshipOrigins = ["inferred", "manual", "derived"] as const;
export type RelationshipOrigin = (typeof relationshipOrigins)[number];

export const relationshipStatuses = ["active", "removed"] as const;
export type RelationshipStatus = (typeof relationshipStatuses)[number];

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export interface Relationship {
  id: string;
  projectId: string;
  source: EntityRef;
  target: EntityRef;
  type: RelationshipType;
  origin: RelationshipOrigin;
  /** 0 to 1 inclusive. */
  confidence: number;
  rationale: string;
  status: RelationshipStatus;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
}

export interface RelationshipListOptions {
  includeRemoved?: boolean;
}

export interface RelationshipStore {
  list(projectId: string, options?: RelationshipListOptions): Promise<Relationship[]>;
  findById(projectId: string, relationshipId: string): Promise<Relationship | undefined>;
  save(relationship: Relationship): Promise<Relationship>;
}

export const maxRelationshipTextLength = 500;

const secretDetector = new SecretDetector();

export function relationshipKey(relationship: Pick<Relationship, "source" | "target" | "type">): string {
  return JSON.stringify([relationship.source.kind, relationship.source.id, relationship.type, relationship.target.kind, relationship.target.id]);
}

/** Deterministic id so repeated or concurrent writes for one origin and key update a single record. */
export function systemRelationshipId(origin: RelationshipOrigin, relationship: Pick<Relationship, "source" | "target" | "type">): string {
  return `rel_${origin}_${createHash("sha256").update(relationshipKey(relationship)).digest("hex").slice(0, 32)}`;
}

export function validateEntityRef(ref: EntityRef, label: string): void {
  if (!(entityKinds as readonly string[]).includes(ref.kind)) throw invalid(`Unsupported ${label} entity kind.`);
  assertSafeText(ref.id, `${label} entity id`);
}

export function validateRelationship(relationship: Relationship): void {
  if (!relationship.projectId.trim()) throw invalid("Relationship requires a project id.");
  validateEntityRef(relationship.source, "source");
  validateEntityRef(relationship.target, "target");
  if (relationship.source.kind === relationship.target.kind && relationship.source.id === relationship.target.id) {
    throw invalid("A relationship cannot connect an entity to itself.");
  }
  if (!(relationshipTypes as readonly string[]).includes(relationship.type)) throw invalid("Unsupported relationship type.");
  if (!(relationshipOrigins as readonly string[]).includes(relationship.origin)) throw invalid("Unsupported relationship origin.");
  if (!(relationshipStatuses as readonly string[]).includes(relationship.status)) throw invalid("Unsupported relationship status.");
  if (!Number.isFinite(relationship.confidence) || relationship.confidence < 0 || relationship.confidence > 1) {
    throw invalid("Relationship confidence must be between 0 and 1.");
  }
  assertSafeText(relationship.rationale, "rationale", true);
}

function assertSafeText(value: string, label: string, allowEmpty = false): void {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw invalid(`Relationship ${label} is required.`);
  if (value.length > maxRelationshipTextLength) throw invalid(`Relationship ${label} is too long.`);
  if (secretDetector.containsSecret(value)) {
    throw new OpenMembraneError({
      code: "SECRET_CANDIDATE",
      message: `Relationship ${label} contains secret-like content.`,
      safeMessage: "Relationships cannot contain secret-like content.",
    });
  }
}

function invalid(message: string): OpenMembraneError {
  return new OpenMembraneError({ code: "VALIDATION_ERROR", message, safeMessage: message });
}
