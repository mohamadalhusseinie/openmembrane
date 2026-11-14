import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGraphQuery,
  graphEdgeClass,
  graphEdgeCoordinates,
  graphPanDelta,
  graphRelationshipDescription,
  graphRefKey,
  graphStatus,
  renderRelationshipEditor,
  layoutGraphNodes,
  updateGraphListSelection,
} from "../../../apps/review-ui/public/graph.js";

class EditorElement {
  children: EditorElement[] = [];
  value = "";
  textContent = "";
  disabled = false;
  required = false;
  focus = vi.fn();
  listeners = new Map<string, (event: { preventDefault: () => void }) => Promise<void> | void>();
  constructor(readonly tag: string) {}
  append(...children: EditorElement[]) { this.children.push(...children); }
  replaceChildren(...children: EditorElement[]) { this.children = children; }
  setAttribute() {}
  addEventListener(name: string, handler: (event: { preventDefault: () => void }) => Promise<void> | void) { this.listeners.set(name, handler); }
  async fire(name: string) { await this.listeners.get(name)?.({ preventDefault: () => {} }); }
  descendants(tag: string): EditorElement[] {
    return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.descendants(tag)]);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("knowledge graph explorer helpers", () => {
  it("creates outgoing links and validates correction rationale while keeping failed drafts editable", async () => {
    vi.stubGlobal("document", {
      createElement: (tag: string) => new EditorElement(tag),
      getElementById: () => ({ options: [{ value: "related_to", textContent: "Related to" }, { value: "conflicts_with", textContent: "Conflicts with" }] }),
    });
    const container = new EditorElement("div");
    const source = { kind: "memory", id: "m1" };
    const target = { kind: "candidate", id: "c1", label: "Candidate" };
    const submit = vi.fn().mockRejectedValue(new Error("Daemon unavailable."));
    renderRelationshipEditor(container as Parameters<typeof renderRelationshipEditor>[0], source, [target], undefined, false, submit);
    const form = container.descendants("form")[0]!;
    const [targetSelect, typeSelect] = container.descendants("select");
    targetSelect!.value = graphRefKey(target);
    typeSelect!.value = "conflicts_with";
    await typeSelect!.fire("change");
    const rationale = container.descendants("textarea")[0]!;
    expect(rationale.required).toBe(true);
    rationale.value = "  ";
    await form.fire("submit");
    expect(submit).not.toHaveBeenCalled();
    rationale.value = "The candidate contradicts this rule.";
    await form.fire("submit");
    expect(submit).toHaveBeenCalledWith({ source, target: { kind: "candidate", id: "c1" }, type: "conflicts_with", rationale: rationale.value }, false);
    expect(container.descendants("fieldset")[0]!.disabled).toBe(false);
    expect(rationale.value).toBe("The candidate contradicts this rule.");
    expect(container.descendants("p").some(item => item.textContent.includes("Daemon unavailable."))).toBe(true);
  });

  it("preserves incoming link direction when overriding and submits removal by identity", async () => {
    vi.stubGlobal("document", {
      createElement: (tag: string) => new EditorElement(tag),
      getElementById: () => ({ options: [{ value: "supersedes", textContent: "Supersedes" }] }),
    });
    const edge = {
      id: "inferred-link", source: { kind: "memory", id: "new" }, target: { kind: "memory", id: "old" },
      type: "supersedes", origin: "inferred" as const, confidence: 1, rationale: "Original inference.",
    };
    for (const remove of [false, true]) {
      const container = new EditorElement("div");
      const submit = vi.fn().mockResolvedValue(undefined);
      renderRelationshipEditor(container as Parameters<typeof renderRelationshipEditor>[0], edge.target, [], edge, remove, submit);
      const rationale = container.descendants("textarea")[0]!;
      expect(rationale.required).toBe(true);
      rationale.value = "Confirmed correction.";
      await container.descendants("form")[0]!.fire("submit");
      expect(submit).toHaveBeenCalledWith(remove
        ? { relationshipId: edge.id, rationale: rationale.value }
        : { source: edge.source, target: edge.target, type: edge.type, rationale: rationale.value }, remove);
    }
  });

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

  it("keeps relationship arrow tips outside selected and unselected target nodes", () => {
    const edge = {
      source: { kind: "memory", id: "source" },
      target: { kind: "memory", id: "target" },
    };
    const positions = new Map([
      [graphRefKey(edge.source), { x: 0, y: 0 }],
      [graphRefKey(edge.target), { x: 100, y: 0 }],
    ]);

    expect(graphEdgeCoordinates(edge, positions, edge.target)?.x2).toBe(88);
    expect(graphEdgeCoordinates(edge, positions)?.x2).toBe(91);
  });

  it("renders relationship type and origin as explicit graph provenance", () => {
    const edge = {
      source: { kind: "candidate", id: "cand_1" },
      target: { kind: "audit_event", id: "audit_1" },
      type: "derived_from",
      origin: "derived",
      confidence: 1,
      rationale: "Candidate approval was recorded.",
      createdAt: "2026-05-08T00:00:00.000Z",
    } as const;

    expect(graphEdgeClass(edge)).toContain("graph-edge-origin-derived");
    expect(graphEdgeClass(edge)).toContain("graph-edge-type-derived_from");
    expect(graphRelationshipDescription(edge, edge.source)).toEqual({
      label: "Outgoing derived from: audit_event: audit_1",
      provenance: "derived, 100% confidence",
      rationale: "Candidate approval was recorded.",
      createdAt: "2026-05-08T00:00:00.000Z",
    });
  });

  it("uses one SVG scale when converting pointer motion to pan deltas", () => {
    expect(graphPanDelta(60, 60, 600, 560)).toEqual({ x: 100, y: 100 });
  });

  it("updates pressed state on existing list buttons when selection changes", () => {
    const buttons = [
      { dataset: { kind: "memory", id: "one" }, setAttribute: vi.fn() },
      { dataset: { kind: "candidate", id: "one" }, setAttribute: vi.fn() },
    ];
    const originalButtons = [...buttons];

    updateGraphListSelection(buttons, { kind: "candidate", id: "one" });

    expect(buttons[0]!.setAttribute).toHaveBeenCalledWith("aria-pressed", "false");
    expect(buttons[1]!.setAttribute).toHaveBeenCalledWith("aria-pressed", "true");
    expect(buttons[0]).toBe(originalButtons[0]);
    expect(buttons[1]).toBe(originalButtons[1]);
  });

  it("reports counts and truncation for the currently visible graph", () => {
    expect(graphStatus(2, 3, true)).toEqual({
      message: "2 nodes, 3 relationships — results limited.",
      kind: "",
    });
    expect(graphStatus(0, 0, false)).toEqual({
      message: "No graph entities match these filters.",
      kind: "empty",
    });
  });
});
