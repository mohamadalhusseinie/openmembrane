import { createHash } from "node:crypto";
import {
  OpenMembraneError,
  SecretDetector,
  relationshipKey,
} from "@openmembrane/core";
import type {
  AuditEvent,
  DiagnosticEvent,
  EntityRef,
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphEntity,
  KnowledgeGraphEntityRef,
  KnowledgeGraphNode,
  KnowledgeGraphQuery,
  MemoryCandidate,
  MemoryEntry,
  Relationship,
  CreateManualRelationshipInput,
} from "@openmembrane/core";
import type { ProjectState } from "./factory";

const defaultEntityLimit = 500;
const maxEntityLimit = 500;
const maxGraphEdges = 5_000;
const maxGraphTextLength = 2_000;
const maxTagsPerEntity = 32;
const secretDetector = new SecretDetector();

interface GraphSnapshot {
  nodes: Map<string, KnowledgeGraphNode>;
  edges: Map<string, KnowledgeGraphEdge>;
  evidence: Relationship[];
  sessionIdMatcher: RegExp | undefined;
}

function refKey(ref: EntityRef): string {
  return JSON.stringify([ref.kind, ref.id]);
}

function safeId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 500 && !secretDetector.containsSecretInAnyCase(value);
}

function redact(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = secretDetector.redact(value).redactedText;
  const withoutMarkers = cleaned.replace(/\[REDACTED:[^\]]+\]/gi, "");
  return (secretDetector.containsSecretInAnyCase(withoutMarkers) ? "[REDACTED:secret]" : cleaned).slice(0, maxLength);
}

function opaqueId(kind: "session" | "tag", value: string): string {
  return `${kind}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function stableEdgeId(source: EntityRef, target: EntityRef, type: string, origin: string): string {
  const identity = JSON.stringify([source.kind, source.id, type, target.kind, target.id, origin]);
  return `graph_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function addNode(nodes: Map<string, KnowledgeGraphNode>, node: KnowledgeGraphNode): void {
  nodes.set(refKey({ kind: node.kind, id: node.id }), node);
}

function addEdge(
  edges: Map<string, KnowledgeGraphEdge>,
  source: EntityRef,
  target: EntityRef,
  type: KnowledgeGraphEdge["type"],
  rationale: string,
  createdAt: string,
  origin: KnowledgeGraphEdge["origin"] = "derived",
  confidence = 1,
): void {
  if (source.kind === target.kind && source.id === target.id) return;
  const id = stableEdgeId(source, target, type, origin);
  edges.set(id, {
    id,
    source,
    target,
    type,
    origin,
    confidence,
    rationale,
    status: "active",
    createdAt,
    updatedAt: createdAt,
  });
}

function safeTags(tags: readonly string[]): string[] {
  const result: string[] = [];
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag || tag.length > 200 || secretDetector.containsSecretInAnyCase(tag)) continue;
    if (!result.includes(tag.toLowerCase())) result.push(tag.toLowerCase());
    if (result.length >= maxTagsPerEntity) break;
  }
  return result;
}

function addMemoryLikeNode(
  nodes: Map<string, KnowledgeGraphNode>,
  edges: Map<string, KnowledgeGraphEdge>,
  item: MemoryEntry | MemoryCandidate,
  kind: "memory" | "candidate",
): void {
  if (!safeId(item.id) || secretDetector.containsSecretInAnyCase(item.content)) return;
  const tags = safeTags(item.tags);
  const candidate = kind === "candidate" ? item as MemoryCandidate : undefined;
  const memory = kind === "memory" ? item as MemoryEntry : undefined;
  const summary = item.reason ? redact(item.reason, 500) : undefined;
  const sourceExcerpt = item.source.excerpt !== undefined ? redact(item.source.excerpt, 280) : undefined;
  const node: KnowledgeGraphNode = {
    id: item.id,
    kind,
    label: kind === "memory" ? `Memory: ${item.type.replaceAll("_", " ")}` : `Candidate: ${item.type.replaceAll("_", " ")}`,
    content: item.content.slice(0, maxGraphTextLength),
    type: item.type,
    scope: item.scope,
    confidence: item.confidence,
    ...(item.sensitivity !== "secret" ? { sensitivity: item.sensitivity } : {}),
    ...(kind === "memory" ? { status: memory!.status } : { recommendedAction: candidate!.recommendedAction }),
    ...(summary !== undefined ? { summary } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.source.tool && !secretDetector.containsSecretInAnyCase(item.source.tool)
      ? { sourceTool: item.source.tool.slice(0, 100) } : {}),
    ...(sourceExcerpt !== undefined ? { sourceExcerpt } : {}),
  };
  addNode(nodes, node);

  const groupings = [
    ...tags.map((tag) => ({ key: `tag:${tag}`, label: `tag: ${tag}`, rationale: "Saved metadata tag." })),
    { key: `scope:${item.scope}`, label: `scope: ${item.scope}`, rationale: "Memory scope grouping." },
    { key: `type:${item.type}`, label: `type: ${item.type}`, rationale: "Memory type grouping." },
  ];
  for (const grouping of groupings) {
    const tagId = opaqueId("tag", grouping.key);
    addNode(nodes, { id: tagId, kind: "tag", label: grouping.label });
    addEdge(edges, { kind, id: item.id }, { kind: "tag", id: tagId }, "tagged_with", grouping.rationale, item.updatedAt);
  }

  if (item.source.kind === "session" || item.source.sessionId !== undefined) {
    const rawSessionId = item.source.sessionId?.trim();
    const validSessionId = rawSessionId && rawSessionId.length <= 500 && !secretDetector.containsSecretInAnyCase(rawSessionId)
      ? rawSessionId
      : undefined;
    const sessionId = validSessionId ? opaqueId("session", validSessionId) : "session_unknown";
    addNode(nodes, {
      id: sessionId,
      kind: "session",
      label: validSessionId ? "Source session" : "Unknown source",
      ...(node.sourceTool ? { sourceTool: node.sourceTool } : {}),
      ...(node.sourceExcerpt ? { sourceExcerpt: node.sourceExcerpt } : {}),
    });
    addEdge(edges, { kind, id: item.id }, { kind: "session", id: sessionId }, "derived_from", "Saved source-session provenance.", item.updatedAt);
  }
}

function referencedEntityIds(event: AuditEvent | DiagnosticEvent, known: Map<string, KnowledgeGraphNode>): EntityRef[] {
  const refs = new Map<string, EntityRef>();
  const add = (id: unknown) => {
    if (typeof id !== "string" || !safeId(id)) return;
    for (const kind of ["memory", "candidate"] as const) {
      const ref = { kind, id };
      if (known.has(refKey(ref))) refs.set(refKey(ref), ref);
    }
  };
  add(event.entityId);
  if ("type" in event && event.type === "memory_saved" && typeof event.details?.candidateId === "string") {
    add(event.details.candidateId);
  }
  if ("type" in event && event.type === "memory_superseded") {
    add(event.details?.supersededBy);
    add(event.details?.replacementId);
  }
  if ("type" in event && event.type === "candidate_rejected") {
    add(event.details?.duplicateOf);
  }
  return [...refs.values()];
}

function addLifecycleNodes(
  nodes: Map<string, KnowledgeGraphNode>,
  edges: Map<string, KnowledgeGraphEdge>,
  audit: readonly AuditEvent[],
  diagnostics: readonly DiagnosticEvent[],
): void {
  for (const event of audit) {
    if (!safeId(event.id)) continue;
    const targets = referencedEntityIds(event, nodes);
    if (targets.length === 0) continue;
    addNode(nodes, {
      id: event.id,
      kind: "audit_event",
      label: event.type.replaceAll("_", " "),
      eventType: event.type,
      createdAt: event.createdAt,
    });
    for (const target of targets) {
      addEdge(edges, { kind: "audit_event", id: event.id }, target, "derived_from", "Related lifecycle event.", event.createdAt);
    }
  }
  for (const event of diagnostics) {
    if (!safeId(event.id)) continue;
    const targets = referencedEntityIds(event, nodes);
    if (event.entityId !== undefined && targets.length === 0) continue;
    const summary = redact(event.message, 500);
    addNode(nodes, {
      id: event.id,
      kind: "diagnostic",
      label: `${event.severity}: ${redact(event.code, 100) ?? "diagnostic"}`,
      ...(summary !== undefined ? { summary } : {}),
      severity: event.severity,
      createdAt: event.createdAt,
    });
    for (const target of targets) {
      addEdge(edges, { kind: "diagnostic", id: event.id }, target, "derived_from", "Related diagnostic event.", event.createdAt);
    }
  }
}

function addHistoricalCandidates(
  nodes: Map<string, KnowledgeGraphNode>,
  audit: readonly AuditEvent[],
  excludedIds: ReadonlySet<string>,
  recentAudit: readonly AuditEvent[],
): void {
  for (const event of recentAudit) {
    if (event.type === "memory_saved" && typeof event.details?.candidateId === "string" &&
      safeId(event.details.candidateId) &&
      !excludedIds.has(event.details.candidateId) &&
      nodes.has(refKey({ kind: "memory", id: event.entityId ?? "" })) &&
      !nodes.has(refKey({ kind: "candidate", id: event.details.candidateId }))) {
      addNode(nodes, {
        id: event.details.candidateId,
        kind: "candidate",
        label: "Approved candidate",
        summary: "Approved candidate; details are no longer available.",
        createdAt: event.createdAt,
      });
    }
  }
  for (const event of audit) {
    const duplicateOf = event.details?.duplicateOf;
    if (event.type !== "candidate_rejected" || !event.entityId || typeof duplicateOf !== "string" ||
      !safeId(event.entityId) || !safeId(duplicateOf)) continue;
    const candidateIds = [event.entityId, ...(duplicateOf.startsWith("cand_") ? [duplicateOf] : [])];
    for (const id of candidateIds) {
      if (excludedIds.has(id) || nodes.has(refKey({ kind: "candidate", id }))) continue;
      addNode(nodes, {
        id,
        kind: "candidate",
        label: "Rejected duplicate candidate",
        summary: "Historical duplicate candidate; details are no longer available.",
        createdAt: event.createdAt,
      });
    }
  }
}

function createSessionIdMatcher(sessionIds: readonly string[]): RegExp | undefined {
  const escapedIds = [...new Set(sessionIds.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return escapedIds.length > 0 ? new RegExp(escapedIds.join("|"), "gi") : undefined;
}

function sanitizedRationale(
  value: string,
  sessionIdMatcher: RegExp | undefined,
): string {
  let rationale = sessionIdMatcher
    ? value.replace(sessionIdMatcher, "[source session]")
    : value;
  rationale = rationale.replace(/same source session:\s*[^;]*/gi, "same source session");
  rationale = redact(rationale, 500) ?? "";
  if (secretDetector.containsSecretInAnyCase(rationale)) rationale = "Relationship evidence is available.";
  return rationale;
}

function sanitizedRelationship(
  relationship: Relationship,
  nodes: Map<string, KnowledgeGraphNode>,
  sessionIdMatcher: RegExp | undefined,
): KnowledgeGraphEdge | undefined {
  if (relationship.status !== "active" ||
    !nodes.has(refKey(relationship.source)) || !nodes.has(refKey(relationship.target)) ||
    !safeId(relationship.source.id) || !safeId(relationship.target.id)) return undefined;
  return {
    id: relationship.id,
    source: relationship.source,
    target: relationship.target,
    type: relationship.type,
    origin: relationship.origin,
    confidence: relationship.confidence,
    rationale: sanitizedRationale(relationship.rationale, sessionIdMatcher),
    status: relationship.status,
    createdAt: relationship.createdAt,
    updatedAt: relationship.updatedAt,
    ...(relationship.removedAt ? { removedAt: relationship.removedAt } : {}),
  };
}

async function graphSnapshot(state: ProjectState, projectId: string): Promise<GraphSnapshot> {
  const [memories, candidates, audit, diagnostics, relationships, evidence] = await Promise.all([
    state.memoryStore.list(projectId, { includeSuperseded: true }),
    state.pendingCandidateStore.list(projectId),
    state.auditLogStore.list(projectId),
    state.diagnosticsLogStore.list(projectId, { limit: 5_000 }),
    state.relationshipService.list(projectId),
    state.relationshipService.listEvidence(projectId),
  ]);
  const nodes = new Map<string, KnowledgeGraphNode>();
  const edges = new Map<string, KnowledgeGraphEdge>();
  for (const memory of memories) addMemoryLikeNode(nodes, edges, memory, "memory");
  for (const candidate of candidates) {
    if (candidate.sensitivity === "secret") continue;
    addMemoryLikeNode(nodes, edges, candidate, "candidate");
  }
  const excludedCandidates = new Set(candidates
    .filter((candidate) => candidate.sensitivity === "secret" ||
      secretDetector.containsSecretInAnyCase(candidate.content))
    .map((candidate) => candidate.id));
  const recentAudit = audit.slice(-5_000);
  addHistoricalCandidates(nodes, audit, excludedCandidates, recentAudit);
  addLifecycleNodes(nodes, edges, recentAudit, diagnostics);
  const manualKeys = new Set(evidence.filter((item) => item.origin === "manual").map(relationshipKey));
  for (const [id, edge] of edges) {
    if (manualKeys.has(relationshipKey(edge))) edges.delete(id);
  }

  const sessionIdMatcher = createSessionIdMatcher([...memories, ...candidates]
    .map((item) => item.source.sessionId)
    .filter((id): id is string => Boolean(id && !secretDetector.containsSecretInAnyCase(id)))
  );
  for (const relationship of relationships) {
    const edge = sanitizedRelationship(relationship, nodes, sessionIdMatcher);
    if (edge) edges.set(edge.id, edge);
  }
  return { nodes, edges, evidence, sessionIdMatcher };
}

function nodeSearchText(node: KnowledgeGraphNode): string {
  return [
    node.label, node.summary, node.content, node.type, node.scope, node.status,
    node.severity, node.eventType, node.sourceTool, node.sourceExcerpt, ...(node.tags ?? []),
  ].filter((value): value is string => value !== undefined).join(" ").toLowerCase();
}

function edgeSearchText(edge: KnowledgeGraphEdge): string {
  return `${edge.type} ${edge.origin} ${edge.rationale}`.toLowerCase();
}

function matchingNodes(snapshot: GraphSnapshot, query: KnowledgeGraphQuery = {}): KnowledgeGraphNode[] {
  const search = query.search?.trim().toLowerCase();
  const kinds = query.entityKinds ? new Set(query.entityKinds) : undefined;
  let nodes = [...snapshot.nodes.values()].filter((node) =>
    (!kinds || kinds.has(node.kind)) && (!search || nodeSearchText(node).includes(search))
  );
  if (search) {
    const edgeMatches = [...snapshot.edges.values()].filter((edge) => edgeSearchText(edge).includes(search));
    const matchingIds = new Set(nodes.map((node) => refKey({ kind: node.kind, id: node.id })));
    for (const edge of edgeMatches) {
      matchingIds.add(refKey(edge.source));
      matchingIds.add(refKey(edge.target));
    }
    nodes = [...snapshot.nodes.values()].filter((node) =>
      (!kinds || kinds.has(node.kind)) && matchingIds.has(refKey({ kind: node.kind, id: node.id }))
    );
  }
  nodes.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  return nodes;
}

function boundedNodes(snapshot: GraphSnapshot, query: KnowledgeGraphQuery = {}): KnowledgeGraphNode[] {
  const limit = Math.min(query.limit ?? defaultEntityLimit, maxEntityLimit);
  const matches = matchingNodes(snapshot, query);
  const memories = matches.filter((node) => node.kind === "memory");
  const candidates = matches.filter((node) => node.kind === "candidate");
  const pendingCandidates = candidates.filter((node) => node.recommendedAction !== undefined);
  const historicalCandidates = candidates.filter((node) => node.recommendedAction === undefined);
  const primaryCount = memories.length + pendingCandidates.length;
  const selected: KnowledgeGraphNode[] = [];
  if (primaryCount > limit) {
    const candidateBudget = Math.min(pendingCandidates.length, Math.ceil(limit * 0.2));
    const memoryBudget = Math.min(memories.length, limit - candidateBudget);
    selected.push(...memories.slice(0, memoryBudget), ...pendingCandidates.slice(0, candidateBudget));
  } else {
    selected.push(...memories, ...pendingCandidates);
  }
  const selectedKeys = new Set(selected.map((node) => refKey({ kind: node.kind, id: node.id })));
  const context = matches.filter((node) => node.kind !== "memory" && node.kind !== "candidate")
    .sort((left, right) => contextPriority(left.kind) - contextPriority(right.kind) ||
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const primaryRemainder = [...pendingCandidates, ...memories];
  for (const group of [primaryRemainder, context, historicalCandidates]) {
    for (const node of group) {
      if (selected.length >= limit) break;
      const key = refKey({ kind: node.kind, id: node.id });
      if (selectedKeys.has(key)) continue;
      selected.push(node);
      selectedKeys.add(key);
    }
  }
  return selected;
}

function contextPriority(kind: KnowledgeGraphNode["kind"]): number {
  switch (kind) {
    case "tag": return 0;
    case "session": return 1;
    case "audit_event": return 2;
    case "diagnostic": return 3;
    case "memory":
    case "candidate": return -1;
  }
}

function assertGraphEndpoints(snapshot: GraphSnapshot, refs: readonly EntityRef[]): void {
  for (const ref of refs) {
    if (!snapshot.nodes.has(refKey(ref))) {
      throw new OpenMembraneError({
        code: ref.kind === "candidate" ? "CANDIDATE_NOT_FOUND" : ref.kind === "memory" ? "MEMORY_NOT_FOUND" : "GRAPH_ENTITY_NOT_FOUND",
        message: "That graph entity does not exist in this project.",
      });
    }
  }
}

export async function createGraphRelationship(
  state: ProjectState,
  projectId: string,
  input: CreateManualRelationshipInput,
): Promise<Relationship> {
  const snapshot = await graphSnapshot(state, projectId);
  assertGraphEndpoints(snapshot, [input.source, input.target]);
  const relationship = await state.relationshipService.createManual(projectId, input);
  return { ...relationship, rationale: sanitizedRationale(relationship.rationale, snapshot.sessionIdMatcher) };
}

export async function removeGraphRelationship(
  state: ProjectState,
  projectId: string,
  input: { relationshipId: string; rationale?: string },
): Promise<Relationship> {
  const snapshot = await graphSnapshot(state, projectId);
  const stored = snapshot.evidence.find((item) => item.id === input.relationshipId);
  const edge = stored ?? snapshot.edges.get(input.relationshipId);
  if (!edge) {
    throw new OpenMembraneError({ code: "VALIDATION_ERROR", message: "That relationship does not exist in this project." });
  }
  assertGraphEndpoints(snapshot, [edge.source, edge.target]);
  const removed = stored
    ? await state.relationshipService.remove(projectId, input.relationshipId, input.rationale)
    : await state.relationshipService.removeProjected(projectId, { ...edge, projectId }, input.rationale);
  return { ...removed, rationale: sanitizedRationale(removed.rationale, snapshot.sessionIdMatcher) };
}

export async function getKnowledgeGraph(
  state: ProjectState,
  projectId: string,
  query: KnowledgeGraphQuery = {},
): Promise<KnowledgeGraph> {
  const snapshot = await graphSnapshot(state, projectId);
  const matchedNodes = matchingNodes(snapshot, query);
  const nodes = boundedNodes(snapshot, query);
  const nodeRefs = new Set(nodes.map((node) => refKey({ kind: node.kind, id: node.id })));
  const relationshipTypes = query.relationshipTypes ? new Set(query.relationshipTypes) : undefined;
  let edges = [...snapshot.edges.values()].filter((edge) =>
    nodeRefs.has(refKey(edge.source)) && nodeRefs.has(refKey(edge.target)) &&
    (!relationshipTypes || relationshipTypes.has(edge.type))
  );
  edges.sort((left, right) => left.id.localeCompare(right.id));
  const truncated = matchedNodes.length > nodes.length || edges.length > maxGraphEdges;
  return { nodes, edges: edges.slice(0, maxGraphEdges), truncated };
}

export async function getKnowledgeGraphEntity(
  state: ProjectState,
  projectId: string,
  ref: KnowledgeGraphEntityRef,
): Promise<KnowledgeGraphEntity> {
  const snapshot = await graphSnapshot(state, projectId);
  const entity = snapshot.nodes.get(refKey(ref));
  if (!entity) {
    throw new OpenMembraneError({
      code: "GRAPH_ENTITY_NOT_FOUND",
      message: `Graph entity ${ref.kind}:${ref.id} was not found.`,
      safeMessage: "That graph entity does not exist in this project.",
    });
  }
  const allEdges = [...snapshot.edges.values()].filter((edge) =>
    refKey(edge.source) === refKey(ref) || refKey(edge.target) === refKey(ref)
  ).sort((left, right) => left.id.localeCompare(right.id));
  const allNeighborRefs = new Map<string, EntityRef>();
  for (const edge of allEdges) {
    const neighbor = refKey(edge.source) === refKey(ref) ? edge.target : edge.source;
    allNeighborRefs.set(refKey(neighbor), neighbor);
  }
  const boundedNeighborRefs = new Map([...allNeighborRefs].slice(0, maxEntityLimit - 1));
  const selectedEdges = allEdges.filter((edge) => {
    const neighbor = refKey(edge.source) === refKey(ref) ? edge.target : edge.source;
    return boundedNeighborRefs.has(refKey(neighbor));
  });
  const edges = selectedEdges.slice(0, maxGraphEdges);
  const returnedNeighborRefs = new Map<string, EntityRef>();
  for (const edge of edges) {
    const neighbor = refKey(edge.source) === refKey(ref) ? edge.target : edge.source;
    returnedNeighborRefs.set(refKey(neighbor), neighbor);
  }
  const neighbors = [...returnedNeighborRefs.values()]
    .map((neighbor) => snapshot.nodes.get(refKey(neighbor)))
    .filter((node): node is KnowledgeGraphNode => node !== undefined)
    .slice(0, maxEntityLimit - 1);
  return {
    entity, edges, neighbors,
    truncated: allEdges.length > edges.length || allNeighborRefs.size > neighbors.length,
  };
}
