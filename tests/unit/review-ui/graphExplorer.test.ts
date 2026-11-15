import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGraphQuery,
  graphEdgeClass,
  graphEdgeCoordinates,
  graphFilterSummary,
  graphKnowledgeOverview,
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
import { graph3dEdgeStyle, graph3dMotionSettings, graphDataUnchanged, layoutGraphNodes3D } from "../../../apps/review-ui/public/graph3d-layout.js";
import {
  clearGraphTooltip,
  clearGraphObjects,
  createGraphPointerSelectionGuard,
  disposeGraphRenderer,
  graph3dNavigationIndex,
  initializeGraphRenderer,
} from "../../../apps/review-ui/public/graph3d-lifecycle.js";
import { createGraphTransition, graph2DFrame } from "../../../apps/review-ui/public/graph-navigation.js";

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
  it("grounds the overview in loaded memory types, distinct proposals, and supporting evidence", () => {
    const nodes = [
      { kind: "memory", id: "m1", type: "coding_rule" },
      { kind: "memory", id: "m2", type: "coding_rule" },
      { kind: "memory", id: "m3" },
      { kind: "candidate", id: "c1", type: "project_fact" },
      { kind: "session", id: "s1" }, { kind: "tag", id: "t1" },
    ];
    const overview = graphKnowledgeOverview(nodes);
    expect(overview.saved.map(node => node.id)).toEqual(["m1", "m2", "m3"]);
    expect(overview.proposals.map(node => node.id)).toEqual(["c1"]);
    expect(overview.evidenceCount).toBe(2);
    expect(overview.memoryTypes).toEqual([{ type: "coding_rule", count: 2 }, { type: "", count: 1 }]);
  });

  it("progressively explores a category without inventing edges or excluding a focused neighbor", () => {
    const memory = { kind: "memory", id: "m", type: "coding_rule" };
    const proposal = { kind: "candidate", id: "c" };
    const tag = { kind: "tag", id: "t" };
    const edge = { source: memory, target: proposal, type: "supports", origin: "manual" as const, confidence: 1, rationale: "Confirmed." };
    const graph = { nodes: [memory, proposal, tag], edges: [edge], focused: false, exploration: "memory", memoryType: "coding_rule" };
    expect(visibleGraphState(graph)).toEqual({ nodes: [memory], edges: [] });
    const { memoryType: _memoryType, ...allTypes } = graph;
    expect(visibleGraphState({ ...allTypes, exploration: "evidence" })).toEqual({ nodes: [tag], edges: [] });
    expect(visibleGraphState({ ...graph, focused: true, entityDetails: { entity: memory, neighbors: [proposal], edges: [edge] } }))
      .toEqual({ nodes: [memory, proposal], edges: [edge] });
  });

  it("summarizes submitted filters in user-facing language without exposing enum names", () => {
    expect(graphFilterSummary({ search: "", kinds: [], relationshipTypes: [] })).toBe("No filters applied.");
    expect(graphFilterSummary({
      search: "  cache & token  ", kinds: ["candidate", "audit_event"], relationshipTypes: ["supersedes", "derived_from"],
    })).toBe('Search: "cache & token" · Showing: Memory proposals, Activity events · Connections: Supersedes (replaces), Derived from');
  });

  it("expands in-app with inert background, Escape restore, and focus returned without browser fullscreen", async () => {
    const source = await readFile(new URL("../../../apps/review-ui/public/graph.js", import.meta.url), "utf8");
    const context = createContext({ URLSearchParams, createGraphTransition, graph2DFrame });
    runInContext(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
    class WorkspaceElement {
      inert = false;
      textContent = "";
      tabIndex = -1;
      attributes = new Map<string, string>();
      children: WorkspaceElement[] = [];
      parentElement: WorkspaceElement | null = null;
      listeners = new Map<string, (event: { key: string; defaultPrevented: boolean; preventDefault(): void }) => void>();
      classList = { toggle: vi.fn() };
      focus = vi.fn();
      setAttribute(name: string, value: string) { this.attributes.set(name, value); }
      removeAttribute(name: string) { this.attributes.delete(name); }
      addEventListener(name: string, handler: (event: { key: string; defaultPrevented: boolean; preventDefault(): void }) => void) { this.listeners.set(name, handler); }
      getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 800 }; }
    }
    const elements = new Map<string, WorkspaceElement>();
    const element = (id: string) => {
      if (!elements.has(id)) elements.set(id, new WorkspaceElement());
      return elements.get(id)!;
    };
    const workspace = element("graph-workspace");
    const background = new WorkspaceElement();
    const alreadyInert = new WorkspaceElement();
    alreadyInert.inert = true;
    const body = new WorkspaceElement();
    workspace.parentElement = body;
    body.children = [workspace, background, alreadyInert];
    const priorFocus = { focus: vi.fn() };
    context.document = { getElementById: element, body, activeElement: priorFocus, addEventListener: vi.fn() };
    context.window = { matchMedia: () => ({ matches: true }) };
    runInContext("setupGraphWorkspace(); setWorkspaceExpanded(true)", context);
    expect(workspace.attributes.get("role")).toBe("dialog");
    expect(workspace.attributes.get("aria-modal")).toBe("true");
    expect(element("graph-expand").focus).toHaveBeenCalledOnce();
    expect(background.inert).toBe(true);
    workspace.listeners.get("keydown")!({ key: "Escape", defaultPrevented: false, preventDefault: vi.fn() });
    expect(workspace.attributes.has("aria-modal")).toBe(false);
    expect(element("graph-expand").attributes.get("aria-pressed")).toBe("false");
    expect(background.inert).toBe(false);
    expect(alreadyInert.inert).toBe(true);
    expect(priorFocus.focus).toHaveBeenCalledOnce();
  });

  it("keeps checkbox drafts separate, applies repeated filters, and clears both drafts and submitted filters", async () => {
    const source = await readFile(new URL("../../../apps/review-ui/public/graph.js", import.meta.url), "utf8");
    const context = createContext({ URLSearchParams, createGraphTransition, graph2DFrame });
    runInContext(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
    type Event = { key?: string; preventDefault: () => void };
    class FilterElement {
      value = "";
      checked = false;
      textContent = "";
      hidden = false;
      disabled = false;
      attributes = new Map<string, string>();
      dataset = { state: "" };
      listeners = new Map<string, (event: Event) => void>();
      focus = vi.fn();
      setAttribute(name: string, value: string) { this.attributes.set(name, value); }
      addEventListener(name: string, listener: (event: Event) => void) { this.listeners.set(name, listener); }
      querySelectorAll(_selector: string): FilterElement[] { return []; }
    }
    const elements = new Map<string, FilterElement>();
    const element = (id: string) => {
      if (!elements.has(id)) elements.set(id, new FilterElement());
      return elements.get(id)!;
    };
    const makeInput = (value: string) => Object.assign(new FilterElement(), { value });
    const kinds = ["memory", "tag"].map(makeInput);
    const relationships = ["supports", "tagged_with"].map(makeInput);
    element("graph-kinds").querySelectorAll = () => kinds.filter(input => input.checked);
    element("graph-relationships").querySelectorAll = () => relationships.filter(input => input.checked);
    element("graph-filters").querySelectorAll = () => [...kinds, ...relationships];
    element("graph-filter-panel").hidden = true;
    context.document = { getElementById: element, querySelectorAll: () => [] };
    const request = vi.fn(async (_path: string, _options?: unknown) => ({ nodes: [], edges: [], truncated: false }));
    context.apiRequest = request;
    for (const name of ["renderGraph", "renderList", "resetInspector"]) context[name] = vi.fn();
    runInContext("setupGraphFilters()", context);
    const fire = (id: string, name: string, key?: string) =>
      element(id).listeners.get(name)!({ ...(key ? { key } : {}), preventDefault: vi.fn() });

    fire("graph-filter-toggle", "click");
    expect(element("graph-filter-panel").hidden).toBe(false);
    expect(element("graph-filter-toggle").attributes.get("aria-expanded")).toBe("true");
    fire("graph-filter-panel", "keydown", "Escape");
    expect(element("graph-filter-panel").hidden).toBe(true);
    expect(element("graph-filter-toggle").attributes.get("aria-expanded")).toBe("false");
    expect(element("graph-filter-toggle").focus).toHaveBeenCalledOnce();

    element("graph-search").value = "cache & token";
    kinds.forEach(input => { input.checked = true; });
    relationships.forEach(input => { input.checked = true; });
    fire("graph-filters", "input");
    expect(request).not.toHaveBeenCalled();
    expect(element("graph-filter-summary").textContent).toBe("No filters applied.");
    expect(element("graph-filter-draft").hidden).toBe(false);
    fire("graph-filters", "submit");
    await Promise.resolve();
    const query = new URLSearchParams(request.mock.calls[0]?.[0]?.split("?")[1]);
    expect(query.get("search")).toBe("cache & token");
    expect(query.getAll("kind")).toEqual(["memory", "tag"]);
    expect(query.getAll("relationshipType")).toEqual(["supports", "tagged_with"]);
    expect(element("graph-filter-summary").textContent).toContain("Showing: Saved memories, Tags");
    expect(element("graph-filter-toggle").textContent).toBe("Filters (4)");
    expect(element("graph-filter-draft").hidden).toBe(true);

    element("graph-search").value = "unapplied draft";
    fire("graph-filters", "input");
    expect(element("graph-filter-summary").textContent).toContain('Search: "cache & token"');
    expect(element("graph-filter-draft").hidden).toBe(false);
    await runInContext("loadGraph()", context);
    await runInContext("mutateRelationship({}, false)", context);
    expect(request).toHaveBeenLastCalledWith(`/api/graph?${query}`);
    expect(element("graph-search").value).toBe("unapplied draft");
    expect(element("graph-filter-draft").hidden).toBe(false);
    fire("graph-clear-filters", "click");
    await Promise.resolve();
    expect(request).toHaveBeenLastCalledWith("/api/graph?limit=500");
    expect([...kinds, ...relationships].every(input => !input.checked)).toBe(true);
    expect(element("graph-search").value).toBe("");
    expect(element("graph-search").focus).toHaveBeenCalledOnce();
    expect(element("graph-filter-summary").textContent).toBe("No filters applied.");
    expect(element("graph-filter-draft").hidden).toBe(true);
    expect(element("graph-clear-filters").hidden).toBe(true);
  });

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
    expect(graphStateAfterRendererSwitch(in3d, "3d")).toBe(in3d);
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
      renderSvg: true,
      svgHidden: false,
      svgDisplay: "block",
      graph3dHidden: true,
      graph3dDisplay: "none",
    });
    expect(graphRendererVisibility("3d")).toEqual({
      renderSvg: false,
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

  it("removes graph edges and nodes before disposing meshes and their resources", () => {
    const nodeMesh = { dispose: vi.fn() };
    const edgeObject = {};
    const geometry = { dispose: vi.fn() };
    const material = { dispose: vi.fn() };
    const scene = { remove: vi.fn() };

    clearGraphObjects(scene, [nodeMesh, edgeObject], [nodeMesh], [geometry, material]);

    expect(scene.remove.mock.calls).toEqual([[nodeMesh], [edgeObject]]);
    expect(nodeMesh.dispose).toHaveBeenCalledOnce();
    expect(geometry.dispose).toHaveBeenCalledOnce();
    expect(material.dispose).toHaveBeenCalledOnce();
  });

  it("suppresses selection for multi-pointer, dragged, and canceled gestures", () => {
    const guard = createGraphPointerSelectionGuard();

    guard.pointerDown(1, 10, 10);
    guard.pointerDown(2, 20, 20);
    expect(guard.pointerUp(2, 20, 20)).toBe(false);
    expect(guard.pointerUp(1, 10, 10)).toBe(false);

    guard.pointerDown(3, 10, 10);
    guard.pointerMove(3, 20, 20);
    expect(guard.pointerUp(3, 20, 20)).toBe(false);

    guard.pointerDown(4, 10, 10);
    guard.pointerCancel(4);
    expect(guard.pointerUp(4, 10, 10)).toBe(false);

    guard.pointerDown(5, 10, 10);
    expect(guard.pointerUp(5, 10, 10)).toBe(true);
  });

  it("clears stale tooltip content when the graph resets", () => {
    const tooltip = { hidden: false, textContent: "Old node label" };

    clearGraphTooltip(tooltip);

    expect(tooltip).toEqual({ hidden: true, textContent: "" });
  });

  it("starts unselected keyboard navigation at the first or last node", () => {
    expect(graph3dNavigationIndex(-1, 500, 1)).toBe(0);
    expect(graph3dNavigationIndex(-1, 500, -1)).toBe(499);
    expect(graph3dNavigationIndex(0, 500, -1)).toBe(499);
    expect(graph3dNavigationIndex(499, 500, 1)).toBe(0);
    expect(graph3dNavigationIndex(-1, 0, -1)).toBeUndefined();
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

  it("recognizes unchanged graph data to preserve 3D layout and scene objects during selection", () => {
    const node = { kind: "memory", id: "m1" };
    const edge = { source: node, target: { kind: "candidate", id: "c1" } };
    expect(graphDataUnchanged([node], [edge], [node], [edge])).toBe(true);
    expect(graphDataUnchanged([node], [edge], [node], [{ ...edge }])).toBe(false);
    expect(graphDataUnchanged([node], [edge], [], [edge])).toBe(false);
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
