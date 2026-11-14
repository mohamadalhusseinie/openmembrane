import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createGraphRoutes } from "../../../../apps/review-ui/src/routes/graph";

function mockContext(params: Record<string, string> = {}, query = new URLSearchParams(), body?: unknown) {
  return {
    params,
    query,
    body,
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
  };
}

describe("review UI graph routes", () => {
  it("passes search and repeated filters to the daemon client", async () => {
    const graph = { nodes: [], edges: [], truncated: false };
    const getKnowledgeGraph = vi.fn().mockResolvedValue(graph);
    const routes = createGraphRoutes({
      getKnowledgeGraph,
      getKnowledgeGraphEntity: vi.fn(),
      createRelationship: vi.fn(),
      removeRelationship: vi.fn(),
    });

    const result = await routes.graph(mockContext({}, new URLSearchParams(
      "search=token%20cache&kind=memory&kind=tag&relationshipType=related_to&relationshipType=tagged_with&limit=40",
    )));

    expect(result.body).toEqual(graph);
    expect(getKnowledgeGraph).toHaveBeenCalledWith({
      search: "token cache",
      entityKinds: ["memory", "tag"],
      relationshipTypes: ["related_to", "tagged_with"],
      limit: 40,
    });
  });

  it("rejects malformed graph filters before calling the daemon", async () => {
    const getKnowledgeGraph = vi.fn();
    const routes = createGraphRoutes({
      getKnowledgeGraph,
      getKnowledgeGraphEntity: vi.fn(),
      createRelationship: vi.fn(),
      removeRelationship: vi.fn(),
    });

    await expect(routes.graph(mockContext({}, new URLSearchParams("kind=unknown")))).rejects.toThrow();
    expect(getKnowledgeGraph).not.toHaveBeenCalled();
  });

  it("requests selected entity details from the daemon client", async () => {
    const detail = { entity: { id: "m1", kind: "memory", label: "Memory" }, edges: [], neighbors: [], truncated: false };
    const getKnowledgeGraphEntity = vi.fn().mockResolvedValue(detail);
    const routes = createGraphRoutes({
      getKnowledgeGraph: vi.fn(),
      getKnowledgeGraphEntity,
      createRelationship: vi.fn(),
      removeRelationship: vi.fn(),
    });

    expect((await routes.entity(mockContext({ kind: "memory", id: "m1" }))).body).toEqual(detail);
    expect(getKnowledgeGraphEntity).toHaveBeenCalledWith({ kind: "memory", id: "m1" });
  });

  it("proxies manual mutations and refuses browser-supplied project routing", async () => {
    const createRelationship = vi.fn().mockResolvedValue({ origin: "manual" });
    const removeRelationship = vi.fn().mockResolvedValue({ status: "removed" });
    const routes = createGraphRoutes({ getKnowledgeGraph: vi.fn(), getKnowledgeGraphEntity: vi.fn(), createRelationship, removeRelationship });
    const input = {
      source: { kind: "memory", id: "mem_1" }, target: { kind: "memory", id: "mem_2" },
      type: "conflicts_with", rationale: "These describe incompatible rules.",
    };
    expect((await routes.createRelationship(mockContext({}, undefined, input))).body).toEqual({ origin: "manual" });
    expect(createRelationship).toHaveBeenCalledWith(input);
    await routes.removeRelationship(mockContext({}, undefined, { relationshipId: "rel_1", rationale: "Incorrect inference." }));
    expect(removeRelationship).toHaveBeenCalledWith({ relationshipId: "rel_1", rationale: "Incorrect inference." });
    await expect(routes.createRelationship(mockContext({}, undefined, { ...input, projectId: "other" }))).rejects.toThrow();
    await expect(routes.removeRelationship(mockContext({}, undefined, { relationshipId: "rel_1", storageDir: "other" }))).rejects.toThrow();
    await expect(routes.createRelationship(mockContext({}, undefined, { ...input, origin: "inferred" }))).rejects.toThrow();
    expect(createRelationship).toHaveBeenCalledTimes(1);
    expect(removeRelationship).toHaveBeenCalledTimes(1);
  });
});
