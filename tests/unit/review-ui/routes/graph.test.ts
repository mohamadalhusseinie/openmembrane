import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createGraphRoutes } from "../../../../apps/review-ui/src/routes/graph";

function mockContext(params: Record<string, string> = {}, query = new URLSearchParams()) {
  return {
    params,
    query,
    body: undefined,
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
    });

    expect((await routes.entity(mockContext({ kind: "memory", id: "m1" }))).body).toEqual(detail);
    expect(getKnowledgeGraphEntity).toHaveBeenCalledWith({ kind: "memory", id: "m1" });
  });
});
