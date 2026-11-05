import { createHash } from "node:crypto";
import {
  OpenMembraneError,
  SecretDetector,
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
    if (targets.length === 0) continue;
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

function sanitizedRelationship(
  relationship: Relationship,
  nodes: Map<string, KnowledgeGraphNode>,
  sessionIds: readonly string[],
): KnowledgeGraphEdge | undefined {
  if (relationship.status !== "active" ||
    relationship.source.kind === "session" || relationship.source.kind === "tag" ||
    relationship.target.kind === "session" || relationship.target.kind === "tag" ||
    !nodes.has(refKey(relationship.source)) || !nodes.has(refKey(relationship.target)) ||
    !safeId(relationship.source.id) || !safeId(relationship.target.id)) return undefined;
  let rationale = relationship.rationale.replace(/same source session:\s*[^;.]+/gi, "same source session");
  for (const id of sessionIds) rationale = rationale.replaceAll(id, "[source session]");
  rationale = redact(rationale, 500) ?? "";
  if (secretDetector.containsSecretInAnyCase(rationale)) rationale = "Relationship evidence is available.";
  return {
    id: relationship.id,
    source: relationship.source,
    target: relationship.target,
    type: relationship.type,
    origin: relationship.origin,
    confidence: relationship.confidence,
    rationale,
    status: relationship.status,
    createdAt: relationship.createdAt,
    updatedAt: relationship.updatedAt,
    ...(relationship.removedAt ? { removedAt: relationship.removedAt } : {}),
  };
}

async function graphSnapshot(state: ProjectState, projectId: string): Promise<GraphSnapshot> {
  await state.relationshipService.syncInferred(projectId);
  const [memories, candidates, audit, diagnostics, relationships] = await Promise.all([
    state.memoryStore.list(projectId, { includeSuperseded: true }),
    state.pendingCandidateStore.list(projectId),
    state.auditLogStore.list(projectId),
    state.diagnosticsLogStore.list(projectId, { limit: 5_000 }),
    state.relationshipService.list(projectId),
  ]);
  const nodes = new Map<string, KnowledgeGraphNode>();
  const edges = new Map<string, KnowledgeGraphEdge>();
  for (const memory of memories) addMemoryLikeNode(nodes, edges, memory, "memory");
  for (const candidate of candidates) {
    if (candidate.sensitivity === "secret") continue;
    addMemoryLikeNode(nodes, edges, candidate, "candidate");
  }
  addLifecycleNodes(nodes, edges, audit.slice(-5_000), diagnostics);

  const rawSessionIds = [...new Set([...memories, ...candidates]
    .map((item) => item.source.sessionId)
    .filter((id): id is string => Boolean(id && !secretDetector.containsSecretInAnyCase(id))))];
  for (const relationship of relationships) {
    const edge = sanitizedRelationship(relationship, nodes, rawSessionIds);
    if (edge) edges.set(edge.id, edge);
  }
  return { nodes, edges };
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

function boundedNodes(snapshot: GraphSnapshot, query: KnowledgeGraphQuery = {}, focus?: EntityRef): KnowledgeGraphNode[] {
  const nodes = matchingNodes(snapshot, query);
  if (focus) {
    const index = nodes.findIndex((node) => refKey({ kind: node.kind, id: node.id }) === refKey(focus));
    if (index >= 0) nodes.unshift(...nodes.splice(index, 1));
  }
  return nodes.slice(0, Math.min(query.limit ?? defaultEntityLimit, maxEntityLimit));
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
  const edges = allEdges.slice(0, maxGraphEdges);
  const neighborRefs = new Map<string, EntityRef>();
  for (const edge of edges) {
    const neighbor = refKey(edge.source) === refKey(ref) ? edge.target : edge.source;
    neighborRefs.set(refKey(neighbor), neighbor);
  }
  const neighbors = [...neighborRefs.values()]
    .map((neighbor) => snapshot.nodes.get(refKey(neighbor)))
    .filter((node): node is KnowledgeGraphNode => node !== undefined)
    .slice(0, maxEntityLimit - 1);
  return {
    entity, edges, neighbors,
    truncated: allEdges.length > edges.length || neighborRefs.size > neighbors.length,
  };
}
