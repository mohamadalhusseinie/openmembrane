import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGraphQuery,
  graphEdgeClass,
  graphEdgeCoordinates,
  graphPanDelta,
  graphRendererFallback,
  graphRelationshipDescription,
  graphRendererVisibility,
  graphRefKey,
  graphStateAfterRendererSwitch,
  graphStatus,
  renderRelationshipEditor,
  layoutGraphNodes,
  updateGraphListSelection,
  visibleGraphState,
} from "../../../apps/review-ui/public/graph.js";
import { graph3dEdgeStyle, graph3dMotionSettings, layoutGraphNodes3D } from "../../../apps/review-ui/public/graph3d-layout.js";
import { disposeGraphRenderer, initializeGraphRenderer } from "../../../apps/review-ui/public/graph3d-lifecycle.js";

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

  it("switches renderers without losing filters, selection, inspector details, or neighborhood focus", () => {
    const node = { kind: "memory", id: "m1" };
    const neighbor = { kind: "candidate", id: "c1" };
    const edge = {
      source: node,
      target: neighbor,
      type: "supports",
      origin: "manual" as const,
      confidence: 1,
      rationale: "Confirmed.",
    };
    const graphState = {
      renderMode: "2d",
      filters: { search: "cache", kinds: ["memory"], relationshipTypes: ["supports"] },
      nodes: [node, neighbor],
      edges: [edge],
      selected: node,
      entityDetails: { entity: node, neighbors: [neighbor], edges: [edge] },
      focused: true,
    };

    const in3d = graphStateAfterRendererSwitch(graphState, "3d");
    const backIn2d = graphStateAfterRendererSwitch(in3d, "2d");
    expect(in3d.filters).toBe(graphState.filters);
    expect(in3d.selected).toBe(node);
    expect(in3d.focused).toBe(true);
    expect(visibleGraphState(in3d)).toEqual({ nodes: [node, neighbor], edges: [edge] });
    expect(backIn2d.filters).toBe(graphState.filters);
    expect(backIn2d.selected).toBe(node);
    expect(backIn2d.focused).toBe(true);
  });

  it("shows only the active renderer", () => {
    expect(graphRendererVisibility("2d")).toEqual({
      svgHidden: false,
      svgDisplay: "block",
      graph3dHidden: true,
      graph3dDisplay: "none",
    });
    expect(graphRendererVisibility("3d")).toEqual({
      svgHidden: true,
      svgDisplay: "none",
      graph3dHidden: false,
      graph3dDisplay: "block",
    });
  });

  it("falls back to the accessible graph with a visible initialization error", () => {
    expect(graphRendererFallback(new Error("WebGL unavailable"))).toEqual({
      renderMode: "2d",
      message: "3D graph unavailable: WebGL unavailable The 2D graph and list remain available.",
    });
    expect(graphRendererFallback("unknown error").message).toContain("unknown error");
  });

  it("does not mount an obsolete asynchronous 3D initialization", async () => {
    let resolveModule: ((module: { renderer: string }) => void) | undefined;
    let current = true;
    const loadModule = () => new Promise<{ renderer: string }>(resolve => { resolveModule = resolve; });
    const mount = vi.fn();
    const pending = initializeGraphRenderer(loadModule, () => current, mount);

    current = false;
    resolveModule!({ renderer: "three" });
    await expect(pending).resolves.toBeUndefined();
    expect(mount).not.toHaveBeenCalled();
  });

  it("propagates renderer initialization errors for the UI recovery path", async () => {
    const mount = vi.fn();
    await expect(initializeGraphRenderer(
      () => Promise.reject(new Error("WebGL unavailable")),
      () => true,
      mount,
    )).rejects.toThrow("WebGL unavailable");
    expect(mount).not.toHaveBeenCalled();
  });

  it("disposes the 3D renderer when returning to the fallback", () => {
    const renderer = { destroy: vi.fn() };
    disposeGraphRenderer(renderer);
    disposeGraphRenderer(undefined);
    expect(renderer.destroy).toHaveBeenCalledOnce();
  });

  it("respects reduced motion and distinguishes all relationship origins without color alone", () => {
    expect(graph3dMotionSettings(true)).toEqual({
      enableDamping: false,
      autoRotate: false,
      rotateSpeed: 0.65,
    });
    expect(graph3dMotionSettings(false).autoRotate).toBe(false);
    expect(graph3dEdgeStyle("inferred")).toEqual({ color: "#6366f1" });
    expect(graph3dEdgeStyle("manual")).toEqual({ color: "#16a34a", dashSize: 8, gapSize: 5 });
    expect(graph3dEdgeStyle("derived")).toEqual({ color: "#f59e0b", dashSize: 2, gapSize: 4 });
  });

  it("places linked nodes in deterministic 3D space for the 500-entity interaction target", () => {
    const nodes = Array.from({ length: 500 }, (_, index) => ({ kind: "memory", id: `m${index}` }));
    const edges = nodes.map((node, index) => ({
      source: node,
      target: nodes[(index + 1) % nodes.length]!,
    }));
    const linked = layoutGraphNodes3D(nodes.slice(0, 2), [edges[0]!]);
    const unlinked = layoutGraphNodes3D(nodes.slice(0, 2), []);
    const linkedSource = linked.get(graphRefKey(nodes[0]!))!;
    const linkedTarget = linked.get(graphRefKey(nodes[1]!))!;
    const unlinkedSource = unlinked.get(graphRefKey(nodes[0]!))!;
    const unlinkedTarget = unlinked.get(graphRefKey(nodes[1]!))!;
    const distance = (left: typeof linkedSource, right: typeof linkedTarget) =>
      Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
    const layout = layoutGraphNodes3D(nodes, edges);
    const repeated = layoutGraphNodes3D(nodes, edges);

    expect(layout.size).toBe(500);
    expect(distance(linkedSource, linkedTarget)).toBeLessThan(distance(unlinkedSource, unlinkedTarget));
    expect(layout.get(graphRefKey(nodes[127]!))).toEqual(repeated.get(graphRefKey(nodes[127]!)));
    expect([...layout.values()].every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))).toBe(true);
  });
});
