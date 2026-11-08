import { describe, expect, it, vi } from "vitest";
import type { AuditEvent, Relationship } from "@openmembrane/core";
import { candidate } from "./helpers";
import type { ProjectState } from "../../packages/service/src/factory";
import { getKnowledgeGraph, getKnowledgeGraphEntity } from "../../packages/service/src/knowledgeGraph";

const projectId = "project-a";
const createdAt = "2026-05-08T00:00:00.000Z";

function duplicateRejection(id: string, entityId: string, duplicateOf: string): AuditEvent {
  return {
    id,
    projectId,
    type: "candidate_rejected",
    entityId,
    createdAt,
    details: { duplicateOf },
  };
}

function duplicateRelationship(sourceId: string, targetId: string): Relationship {
  return {
    id: `relationship-${sourceId}-${targetId}`,
    projectId,
    source: { kind: "candidate", id: sourceId },
    target: { kind: "candidate", id: targetId },
    type: "duplicate_of",
    origin: "derived",
    confidence: 1,
    rationale: "Rejected as a duplicate during extraction.",
    status: "active",
    createdAt,
    updatedAt: createdAt,
  };
}

describe("knowledge graph historical candidates", () => {
  it("keeps safe duplicate endpoints beyond the lifecycle window and excludes unsafe pending candidates", async () => {
    const audit: AuditEvent[] = [
      duplicateRejection("old-rejection", "cand_removed", "cand_old"),
      duplicateRejection("secret-rejection", "cand_secret_sensitivity", "mem_1"),
      duplicateRejection("secret-content-rejection", "cand_secret_content", "mem_1"),
      duplicateRejection("unsafe-target-rejection", "cand_source_to_unsafe", "cand_secret_content"),
      ...Array.from({ length: 5_000 }, (_, index): AuditEvent => ({
        id: `later-event-${index}`,
        projectId,
        type: "memory_saved",
        createdAt,
      })),
    ];
    const relationships = [
      duplicateRelationship("cand_removed", "cand_old"),
      duplicateRelationship("cand_secret_sensitivity", "mem_1"),
      duplicateRelationship("cand_secret_content", "mem_1"),
      duplicateRelationship("cand_source_to_unsafe", "cand_secret_content"),
    ];
    const state = {
      memoryStore: { list: vi.fn(async () => []) },
      pendingCandidateStore: {
        list: vi.fn(async () => [
          candidate({ id: "cand_secret_sensitivity", sensitivity: "secret" }),
          candidate({ id: "cand_secret_content", content: "Store api_key=abcdefghijk123456 securely." }),
        ]),
      },
      auditLogStore: { list: vi.fn(async () => audit) },
      diagnosticsLogStore: { list: vi.fn(async () => []) },
      relationshipService: {
        syncInferred: vi.fn(async () => []),
        list: vi.fn(async () => relationships),
        listEvidence: vi.fn(async () => []),
      },
    } as unknown as ProjectState;

    const graph = await getKnowledgeGraph(state, projectId);
    const nodeRefs = new Set(graph.nodes.map((node) => JSON.stringify([node.kind, node.id])));
    expect(nodeRefs.has(JSON.stringify(["candidate", "cand_removed"]))).toBe(true);
    expect(nodeRefs.has(JSON.stringify(["candidate", "cand_old"]))).toBe(true);
    expect(nodeRefs.has(JSON.stringify(["candidate", "cand_source_to_unsafe"]))).toBe(true);
    expect(nodeRefs.has(JSON.stringify(["candidate", "cand_secret_sensitivity"]))).toBe(false);
    expect(nodeRefs.has(JSON.stringify(["candidate", "cand_secret_content"]))).toBe(false);
    expect(graph.nodes.some((node) => node.kind === "audit_event" && node.id === "old-rejection")).toBe(false);
    expect(graph.edges).toContainEqual(expect.objectContaining({
      source: { kind: "candidate", id: "cand_removed" },
      target: { kind: "candidate", id: "cand_old" },
      type: "duplicate_of",
    }));
    expect(graph.edges.some((edge) => edge.target.id === "cand_secret_content")).toBe(false);

    const detail = await getKnowledgeGraphEntity(state, projectId, { kind: "candidate", id: "cand_old" });
    expect(detail.neighbors).toContainEqual(expect.objectContaining({ kind: "candidate", id: "cand_removed" }));
    expect(state.relationshipService.syncInferred).not.toHaveBeenCalled();
  });
});
