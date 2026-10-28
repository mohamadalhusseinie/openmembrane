import { normalizeMemoryContent } from "../deduplication/Deduplicator";
import { SecretDetector } from "../filtering/SecretDetector";
import type { MemoryCandidate } from "../types/MemoryCandidate";
import type { MemoryEntry } from "../types/MemoryEntry";
import { maxRelationshipTextLength, relationshipKey, type EntityRef } from "./Relationship";
import type { RelationshipDraft } from "./RelationshipService";

export interface Supersession {
  supersededId: string;
  supersededBy: string;
}

export interface RelationshipInferenceInput {
  /** Active and superseded memories. */
  memories: MemoryEntry[];
  /** Pending candidates. */
  candidates: MemoryCandidate[];
  /** Supersession records that are not reflected on `MemoryEntry.supersededBy`, such as audit events. */
  supersessions?: Supersession[];
}

export interface RelationshipInferenceOptions {
  /** Maximum entities considered; extra entities are dropped deterministically. */
  maxEntities?: number;
  /** Maximum inferred `related_to` links per entity. */
  maxLinksPerEntity?: number;
  /** Minimum confidence for `related_to` links. */
  minConfidence?: number;
  /** Text-only links below this confidence are omitted unless `includeLowConfidenceTextMatches` is set. */
  minTextOnlyConfidence?: number;
  includeLowConfidenceTextMatches?: boolean;
}

export const defaultInferenceOptions = {
  maxEntities: 500,
  maxLinksPerEntity: 8,
  minConfidence: 0.4,
  minTextOnlyConfidence: 0.6,
  includeLowConfidenceTextMatches: false,
} as const satisfies Required<RelationshipInferenceOptions>;

const tagWeight = 0.3;
const maxTagScore = 0.6;
const sessionWeight = 0.35;
const compatibleWeight = 0.15;
const minTextSimilarity = 0.15;
const maxTokensPerEntity = 64;
const maxTagsPerEntity = 32;
const maxTagsInspected = 128;
const maxTagLength = 64;
const maxSessionIdLength = 128;
const maxRationaleTags = 5;
const maxRationaleValueLength = 40;

interface InferenceEntity {
  ref: EntityRef;
  key: string;
  item: MemoryEntry | MemoryCandidate;
  type: string;
  scope: string;
  tags: string[];
  tagSet: Set<string>;
  sessionId: string | undefined;
  tokens: Set<string>;
}

const secretDetector = new SecretDetector();

/** Deterministic, local relationship inference: identical input always yields identical, sorted drafts. */
export function inferRelationships(input: RelationshipInferenceInput, options: RelationshipInferenceOptions = {}): RelationshipDraft[] {
  const settings = { ...defaultInferenceOptions, ...options };
  const entities = collectEntities(input, settings.maxEntities);
  const drafts = new Map<string, RelationshipDraft>();
  const linkedPairs = new Set<string>();

  for (const draft of metadataDrafts(input, entities)) {
    if (refKey(draft.source) === refKey(draft.target)) continue;
    drafts.set(relationshipKey(draft), draft);
    linkedPairs.add(pairKey(draft.source, draft.target));
  }

  const related: RelationshipDraft[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const left = entities[i]!;
      const right = entities[j]!;
      if (linkedPairs.has(pairKey(left.ref, right.ref))) continue;
      const draft = scorePair(left, right, settings);
      if (draft) related.push(draft);
    }
  }

  // Greedy degree cap over a total order keeps the output bounded and deterministic.
  related.sort((left, right) => right.confidence - left.confidence || compare(relationshipKey(left), relationshipKey(right)));
  const degree = new Map<string, number>();
  for (const draft of related) {
    const source = refKey(draft.source);
    const target = refKey(draft.target);
    if ((degree.get(source) ?? 0) >= settings.maxLinksPerEntity || (degree.get(target) ?? 0) >= settings.maxLinksPerEntity) continue;
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
    drafts.set(relationshipKey(draft), draft);
  }

  return [...drafts.entries()].sort(([left], [right]) => compare(left, right)).map(([, draft]) => draft);
}

function collectEntities(input: RelationshipInferenceInput, maxEntities: number): InferenceEntity[] {
  // Equal ids are resolved by a canonical content tiebreak so duplicate records never depend on input order.
  const memories = [...input.memories]
    .filter((memory) => !secretDetector.containsSecret(memory.content))
    .sort((left, right) => statusRank(left) - statusRank(right) || compare(left.id, right.id) || compare(canonicalJson(left), canonicalJson(right)));
  const candidates = [...input.candidates]
    .filter((candidate) => candidate.sensitivity !== "secret" && !secretDetector.containsSecret(candidate.content))
    .sort((left, right) => compare(left.id, right.id) || compare(canonicalJson(left), canonicalJson(right)));
  const entities: InferenceEntity[] = [];
  const seen = new Set<string>();
  for (const [kind, item] of [
    ...memories.map((memory) => ["memory", memory] as const),
    ...candidates.map((candidate) => ["candidate", candidate] as const),
  ]) {
    const ref: EntityRef = { kind, id: item.id };
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    const tags = safeTags(item.tags);
    entities.push({
      ref,
      key,
      item,
      type: item.type,
      scope: item.scope,
      tags,
      tagSet: new Set(tags),
      sessionId: safeSessionId(item.source.sessionId),
      tokens: contentTokens(item.content),
    });
    if (entities.length >= maxEntities) break;
  }
  return entities.sort((left, right) => compare(left.key, right.key));
}

/** Stored tags may already be lowercased, so case-sensitive detector patterns are also checked against uppercase. */
function safeTags(tags: readonly string[]): string[] {
  // Inspection is budgeted, including rejected tags, so pathological tag lists stay bounded.
  const inspected = [...new Set(tags.slice(0, maxTagsInspected).map((tag) => tag.trim()).filter((tag) => tag && tag.length <= maxTagLength))]
    .sort((left, right) => compare(left.toLowerCase(), right.toLowerCase()) || compare(left, right));
  const safe = new Set<string>();
  for (const tag of inspected) {
    if (safe.size >= maxTagsPerEntity) break;
    if (containsSecretInAnyCase(tag)) continue;
    safe.add(tag.toLowerCase());
  }
  return [...safe];
}

function safeSessionId(sessionId: string | undefined): string | undefined {
  const trimmed = sessionId?.trim();
  if (!trimmed || trimmed.length > maxSessionIdLength || containsSecretInAnyCase(trimmed)) return undefined;
  return trimmed;
}

function containsSecretInAnyCase(value: string): boolean {
  return secretDetector.containsSecret(value) || secretDetector.containsSecret(value.toLowerCase()) || secretDetector.containsSecret(value.toUpperCase());
}

function metadataDrafts(input: RelationshipInferenceInput, entities: InferenceEntity[]): RelationshipDraft[] {
  const memoryIds = new Set(entities.filter((entity) => entity.ref.kind === "memory").map((entity) => entity.ref.id));
  const candidateIds = new Set(entities.filter((entity) => entity.ref.kind === "candidate").map((entity) => entity.ref.id));
  const resolve = (id: string): EntityRef | undefined => {
    if (memoryIds.has(id)) return { kind: "memory", id };
    if (candidateIds.has(id)) return { kind: "candidate", id };
    // Approved candidates become memories with a `mem_` id.
    const approved = id.replace(/^cand_/, "mem_");
    return memoryIds.has(approved) ? { kind: "memory", id: approved } : undefined;
  };
  const drafts: RelationshipDraft[] = [];
  const supersessions: Supersession[] = [...(input.supersessions ?? [])];
  for (const entity of entities) {
    if (entity.ref.kind === "memory") {
      const memory = entity.item as MemoryEntry;
      if (memory.supersededBy) supersessions.push({ supersededId: memory.id, supersededBy: memory.supersededBy });
      continue;
    }
    const candidate = entity.item as MemoryCandidate;
    const source = entity.ref;
    const duplicate = candidate.duplicateOf ? resolve(candidate.duplicateOf) : undefined;
    if (duplicate) {
      drafts.push({ source, target: duplicate, type: "duplicate_of", confidence: 1, rationale: "Recorded as a duplicate during extraction." });
    }
    for (const conflictId of candidate.conflictWith ?? []) {
      const target = resolve(conflictId);
      if (target) drafts.push({ source, target, type: "conflicts_with", confidence: 1, rationale: "Recorded as conflicting during extraction." });
    }
  }
  for (const { supersededId, supersededBy } of supersessions) {
    const target = memoryIds.has(supersededId) ? ({ kind: "memory", id: supersededId } as const) : undefined;
    const source = resolve(supersededBy);
    if (source && target) drafts.push({ source, target, type: "supersedes", confidence: 1, rationale: "Recorded as superseding this memory." });
  }
  return drafts;
}

function scorePair(left: InferenceEntity, right: InferenceEntity, settings: Required<RelationshipInferenceOptions>): RelationshipDraft | undefined {
  const sharedTags = left.tags.filter((tag) => right.tagSet.has(tag));
  const sharedSession = left.sessionId !== undefined && left.sessionId === right.sessionId;
  const similarity = jaccard(left.tokens, right.tokens);
  const textScore = similarity >= minTextSimilarity ? similarity : 0;
  const tagScore = Math.min(maxTagScore, sharedTags.length * tagWeight);
  const sessionScore = sharedSession ? sessionWeight : 0;
  if (tagScore === 0 && sessionScore === 0 && textScore === 0) return undefined;
  const compatible = left.type === right.type && left.scope === right.scope;
  const compatibleScore = compatible ? compatibleWeight : 0;

  const confidence = round(1 - [tagScore, sessionScore, textScore, compatibleScore].reduce((miss, score) => miss * (1 - score), 1));
  const textOnly = tagScore === 0 && sessionScore === 0;
  if (confidence < settings.minConfidence) return undefined;
  if (textOnly && !settings.includeLowConfidenceTextMatches && confidence < settings.minTextOnlyConfidence) return undefined;

  const detailed: string[] = [];
  const generic: string[] = [];
  if (sharedTags.length > 0) {
    const shown = sharedTags.filter((tag) => tag.length <= maxRationaleValueLength).slice(0, maxRationaleTags);
    const extra = sharedTags.length - shown.length;
    detailed.push(shown.length > 0 ? `shared tags: ${shown.join(", ")}${extra > 0 ? ` (+${extra} more)` : ""}` : `shared tags (${sharedTags.length})`);
    generic.push(`shared tags (${sharedTags.length})`);
  }
  if (sharedSession) {
    const session = left.sessionId!;
    detailed.push(session.length <= maxRationaleValueLength ? `same source session: ${session}` : "same source session");
    generic.push("same source session");
  }
  const fixed: string[] = [];
  if (compatible) fixed.push(`same scope and type: ${left.scope} ${left.type}`);
  if (textScore > 0) fixed.push(`text similarity: ${round(similarity).toFixed(2)}`);

  // Safe values can combine with surrounding punctuation into secret-like text; fall back to value-free evidence.
  const rationale = `Inferred from ${[...detailed, ...fixed].join("; ")}.`;
  const safe = rationale.length <= maxRelationshipTextLength && !secretDetector.containsSecret(rationale);
  return {
    source: left.ref,
    target: right.ref,
    type: "related_to",
    confidence,
    rationale: safe ? rationale : `Inferred from ${[...generic, ...fixed].join("; ")}.`,
  };
}

function contentTokens(content: string): Set<string> {
  const tokens = [...new Set(normalizeMemoryContent(content).split(" ").filter((token) => token.length > 2))];
  return new Set(tokens.slice(0, maxTokensPerEntity));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function statusRank(memory: MemoryEntry): number {
  return memory.status === "active" ? 0 : 1;
}

/** JSON with sorted object keys, so equal records serialize identically regardless of property order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => compare(left, right)))
      : item,
  );
}

function refKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

function pairKey(left: EntityRef, right: EntityRef): string {
  const [first, second] = [refKey(left), refKey(right)].sort(compare);
  return `${first}|${second}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Locale-independent ordering so output does not depend on the host environment. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
