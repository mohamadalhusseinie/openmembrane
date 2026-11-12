import { describe, expect, it } from "vitest";
import { buildGraphQuery, graphRefKey, layoutGraphNodes } from "../../../apps/review-ui/public/graph.js";

describe("knowledge graph explorer helpers", () => {
  it("keeps node references distinct across kinds and lays out each node deterministically", () => {
    const nodes = [
      { kind: "memory", id: "same" },
      { kind: "candidate", id: "same" },
      { kind: "tag", id: "tag_1" },
    ];
    const first = layoutGraphNodes(nodes);
    const second = layoutGraphNodes(nodes);

    expect(first.size).toBe(3);
    expect(first.get(graphRefKey(nodes[0]!))).toEqual(second.get(graphRefKey(nodes[0]!)));
    expect(first.get(graphRefKey(nodes[0]!))).not.toEqual(first.get(graphRefKey(nodes[1]!)));
    expect(layoutGraphNodes([nodes[0]!]).get(graphRefKey(nodes[0]!))).toEqual({ x: 500, y: 350 });
  });

  it("encodes search and preserves repeated node and relationship filters", () => {
    const query = new URLSearchParams(buildGraphQuery("  cache & token  ", ["memory", "tag"], ["related_to", "tagged_with"]));

    expect(query.get("search")).toBe("cache & token");
    expect(query.getAll("kind")).toEqual(["memory", "tag"]);
    expect(query.getAll("relationshipType")).toEqual(["related_to", "tagged_with"]);
    expect(query.get("limit")).toBe("500");
  });
});
