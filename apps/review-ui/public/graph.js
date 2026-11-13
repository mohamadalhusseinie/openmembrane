const svgNamespace = "http://www.w3.org/2000/svg";

export function graphRefKey(ref) {
  return JSON.stringify([ref.kind, ref.id]);
}

export function buildGraphQuery(search, kinds, relationshipTypes) {
  const params = new URLSearchParams({ limit: "500" });
  if (search.trim()) params.set("search", search.trim());
  kinds.forEach(kind => params.append("kind", kind));
  relationshipTypes.forEach(type => params.append("relationshipType", type));
  return params.toString();
}

export function layoutGraphNodes(nodes) {
  const centerX = 500;
  const centerY = 350;
  const maxRadius = 300;
  const positions = new Map();
  nodes.forEach((node, index) => {
    const angle = index * 2.399963229728653;
    const radius = nodes.length < 2 ? 0 : maxRadius * Math.sqrt((index + 1) / nodes.length);
    positions.set(graphRefKey(node), {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });
  return positions;
}

export function graphEdgeCoordinates(edge, positions, selected) {
  const source = positions.get(graphRefKey(edge.source));
  const target = positions.get(graphRefKey(edge.target));
  if (!source || !target) return undefined;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  const targetRadius = selected && graphRefKey(selected) === graphRefKey(edge.target) ? 10 : 7;
  if (distance <= targetRadius + 2) return undefined;
  return {
    x1: source.x,
    y1: source.y,
    x2: target.x - dx / distance * (targetRadius + 2),
    y2: target.y - dy / distance * (targetRadius + 2),
  };
}

export function graphPanDelta(deltaX, deltaY, width, height) {
  const scale = Math.min(width / 1000, height / 700);
  if (scale <= 0) return { x: 0, y: 0 };
  return { x: deltaX / scale, y: deltaY / scale };
}

export function graphStatus(nodeCount, edgeCount, truncated) {
  return nodeCount
    ? { message: `${nodeCount} nodes, ${edgeCount} relationships${truncated ? " — results limited" : ""}.`, kind: "" }
    : { message: "No graph entities match these filters.", kind: "empty" };
}

export function updateGraphListSelection(buttons, selected) {
  Array.from(buttons).forEach(button => {
    const isSelected = selected !== undefined &&
      button.dataset.kind === selected.kind && button.dataset.id === selected.id;
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

const state = {
  nodes: [],
  edges: [],
  graphTruncated: false,
  selected: undefined,
  entityDetails: undefined,
  focused: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  showList: false,
  requestId: 0,
  scene: undefined,
};

function getElement(id) {
  return document.getElementById(id);
}

function setStatus(message, kind = "") {
  const status = getElement("graph-status");
  status.textContent = message;
  status.dataset.state = kind;
}

function updateGraphStatus() {
  const { nodes, edges } = visibleGraph();
  const truncated = state.focused && state.entityDetails
    ? state.entityDetails.truncated
    : state.graphTruncated;
  const status = graphStatus(nodes.length, edges.length, truncated);
  setStatus(status.message, status.kind);
}

function selectedValues(select) {
  return Array.from(select.selectedOptions, option => option.value);
}

async function apiRequest(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(typeof data.error === "string" ? data.error : "Request failed.");
    error.code = data.code;
    error.diagnosticId = data.diagnosticId;
    error.status = response.status;
    throw error;
  }
  return data;
}

function errorText(error) {
  return `${error.message}${error.diagnosticId ? ` (diagnostic: ${error.diagnosticId})` : ""}`;
}

function visibleGraph() {
  if (state.focused && state.entityDetails) {
    return {
      nodes: [state.entityDetails.entity, ...state.entityDetails.neighbors],
      edges: state.entityDetails.edges,
    };
  }
  return { nodes: state.nodes, edges: state.edges };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(svgNamespace, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function renderGraph() {
  const svg = getElement("graph-canvas");
  const { nodes, edges } = visibleGraph();
  const positions = layoutGraphNodes(nodes);
  const scene = svgElement("g");
  const defs = svgElement("defs");
  [["inferred", "#6366f1"], ["manual", "#16a34a"], ["derived", "#f59e0b"]].forEach(([origin, color]) => {
    const marker = svgElement("marker", {
      id: `graph-arrow-${origin}`, viewBox: "0 0 10 10", refX: "9", refY: "5",
      markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse",
    });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }));
    defs.append(marker);
  });
  scene.append(defs);

  edges.forEach(edge => {
    const coordinates = graphEdgeCoordinates(edge, positions, state.selected);
    if (!coordinates) return;
    const line = svgElement("line", {
      ...coordinates,
      class: `graph-edge graph-edge-origin-${edge.origin}`,
      "marker-end": `url(#graph-arrow-${edge.origin})`,
    });
    const title = svgElement("title");
    title.textContent = `${edge.type.replaceAll("_", " ")}; ${edge.origin}; confidence ${Math.round(edge.confidence * 100)}%; ${edge.rationale}`;
    line.append(title);
    scene.append(line);
  });

  nodes.forEach(node => {
    const position = positions.get(graphRefKey(node));
    const selected = state.selected && graphRefKey(state.selected) === graphRefKey(node);
    const group = svgElement("g", {
      class: `graph-node graph-kind-${node.kind}${selected ? " is-selected" : ""}`,
      transform: `translate(${position.x} ${position.y})`,
      tabindex: "0",
      role: "button",
      "aria-pressed": Boolean(selected),
      "aria-label": `${node.kind.replaceAll("_", " ")}: ${node.label}`,
      "data-kind": node.kind,
      "data-id": node.id,
    });
    const title = svgElement("title");
    title.textContent = `${node.label}${node.content ? ` — ${node.content}` : ""}`;
    group.append(title);
    group.append(svgElement("circle", { r: selected ? 10 : 7 }));
    if (nodes.length <= 35 || selected) {
      const label = svgElement("text", { x: 11, y: 4, class: "graph-node-label" });
      label.textContent = node.label.length > 32 ? `${node.label.slice(0, 29)}…` : node.label;
      group.append(label);
    }
    group.addEventListener("click", event => selectNode(node, "graph", event.currentTarget));
    group.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(node, "graph", event.currentTarget);
      }
    });
    scene.append(group);
  });
  state.scene = scene;
  svg.replaceChildren(scene);
  updateViewport();
}

function updateViewport() {
  if (state.scene) {
    state.scene.setAttribute("transform", `translate(${state.panX} ${state.panY}) scale(${state.zoom})`);
  }
}

function appendProperty(list, label, value) {
  if (value === undefined || value === null || value === "") return;
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = Array.isArray(value) ? value.join(", ") : String(value);
  list.append(term, description);
}

function reviewButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function renderInspector(node, edges = []) {
  const inspector = getElement("graph-inspector");
  inspector.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Node inspector";
  inspector.append(heading);
  const label = document.createElement("h3");
  label.textContent = node.label;
  inspector.append(label);
  const properties = document.createElement("dl");
  properties.className = "graph-properties";
  appendProperty(properties, "Kind", node.kind);
  appendProperty(properties, "ID", node.id);
  appendProperty(properties, "Type", node.type);
  appendProperty(properties, "Scope", node.scope);
  appendProperty(properties, "Status", node.status);
  appendProperty(properties, "Sensitivity", node.sensitivity);
  appendProperty(properties, "Confidence", node.confidence);
  appendProperty(properties, "Recommended action", node.recommendedAction);
  appendProperty(properties, "Severity", node.severity);
  appendProperty(properties, "Event type", node.eventType);
  appendProperty(properties, "Source tool", node.sourceTool);
  appendProperty(properties, "Created", node.createdAt ? new Date(node.createdAt).toLocaleString() : undefined);
  appendProperty(properties, "Updated", node.updatedAt ? new Date(node.updatedAt).toLocaleString() : undefined);
  appendProperty(properties, "Tags", node.tags);
  inspector.append(properties);
  if (node.content || node.summary || node.sourceExcerpt) {
    const detailsHeading = document.createElement("h3");
    detailsHeading.textContent = "Details";
    inspector.append(detailsHeading);
    [node.content, node.summary, node.sourceExcerpt].filter(Boolean).forEach(value => {
      const paragraph = document.createElement("p");
      paragraph.className = "hint";
      paragraph.textContent = value;
      inspector.append(paragraph);
    });
  }
  if (node.kind === "memory" && node.status === "active" && node.content) {
    inspector.append(reviewButton("Review or edit memory", () => {
      window.dispatchEvent(new CustomEvent("review-graph-memory", { detail: node }));
    }));
  }
  if (node.kind === "candidate" && node.content) {
    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      reviewButton("Approve", () => reviewCandidate(node.id, "approve")),
      reviewButton("Reject", () => reviewCandidate(node.id, "reject")),
    );
    inspector.append(actions);
  }
  const relationshipsHeading = document.createElement("h3");
  relationshipsHeading.textContent = `Relationships (${edges.length})`;
  inspector.append(relationshipsHeading);
  const list = document.createElement("ul");
  list.className = "graph-relations";
  edges.forEach(edge => {
    const item = document.createElement("li");
    const from = edge.source.kind === node.kind && edge.source.id === node.id ? "to" : "from";
    const neighbor = from === "to" ? edge.target : edge.source;
    item.textContent = `${edge.type.replaceAll("_", " ")} ${from} ${neighbor.kind}: ${neighbor.id}. ${edge.origin}, ${Math.round(edge.confidence * 100)}% confidence. ${edge.rationale}`;
    list.append(item);
  });
  inspector.append(list);
}

function resetInspector() {
  const inspector = getElement("graph-inspector");
  inspector.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Node inspector";
  const message = document.createElement("p");
  message.className = "hint";
  message.textContent = "Select a graph node to inspect its details and relationships.";
  inspector.append(heading, message);
}

async function reviewCandidate(id, action) {
  try {
    const reason = action === "reject" ? window.prompt("Reason for rejection:") : undefined;
    if (reason === null) return;
    const options = action === "reject"
      ? {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reason ? { reason } : {}),
        }
      : { method: "POST" };
    await apiRequest(`/api/candidates/${encodeURIComponent(id)}/${action}`, options);
    window.dispatchEvent(new CustomEvent("review-graph-candidates-mutated"));
    setStatus(action === "approve" ? "Candidate approved." : "Candidate rejected.", "success");
    state.selected = undefined;
    state.entityDetails = undefined;
    state.focused = false;
    await loadGraph();
  } catch (error) {
    setStatus(`Review action failed: ${errorText(error)}`, "error");
  }
}

function nodeControl(node, view) {
  const selector = view === "graph" ? "#graph-canvas .graph-node" : "#graph-list button[data-graph-node]";
  return Array.from(document.querySelectorAll(selector)).find(control =>
    control.dataset.kind === node.kind && control.dataset.id === node.id,
  );
}

async function selectNode(node, view, control) {
  const shouldRestoreFocus = control && document.activeElement === control;
  state.selected = node;
  state.entityDetails = undefined;
  updateGraphListSelection(
    getElement("graph-list").querySelectorAll("button[data-graph-node]"),
    node,
  );
  updateGraphStatus();
  getElement("graph-focus").disabled = true;
  renderGraph();
  let focusedControl = shouldRestoreFocus ? nodeControl(node, view) : undefined;
  focusedControl?.focus();
  const inspector = getElement("graph-inspector");
  inspector.textContent = "Loading node details…";
  try {
    const detail = await apiRequest(`/api/graph/entities/${encodeURIComponent(node.kind)}/${encodeURIComponent(node.id)}`);
    if (!state.selected || graphRefKey(state.selected) !== graphRefKey(node)) return;
    const shouldKeepFocus = shouldRestoreFocus && document.activeElement === focusedControl;
    state.entityDetails = detail;
    getElement("graph-focus").disabled = false;
    renderInspector(detail.entity, detail.edges);
    if (state.focused) {
      renderGraph();
      renderList();
    }
    updateGraphStatus();
    if (shouldKeepFocus) {
      focusedControl = nodeControl(node, view);
      focusedControl?.focus();
    }
  } catch (error) {
    if (!state.selected || graphRefKey(state.selected) !== graphRefKey(node)) return;
    inspector.textContent = `Could not load node details: ${errorText(error)}`;
    getElement("graph-focus").disabled = true;
  }
}

export async function loadGraph() {
  const requestId = ++state.requestId;
  state.selected = undefined;
  state.entityDetails = undefined;
  state.focused = false;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  state.nodes = [];
  state.edges = [];
  state.graphTruncated = false;
  getElement("graph-focus").textContent = "Focus neighborhood";
  getElement("graph-focus").disabled = true;
  setStatus("Loading graph…", "loading");
  resetInspector();
  renderGraph();
  renderList();
  try {
    const query = buildGraphQuery(
      getElement("graph-search").value,
      selectedValues(getElement("graph-kinds")),
      selectedValues(getElement("graph-relationships")),
    );
    const graph = await apiRequest(`/api/graph?${query}`);
    if (requestId !== state.requestId) return;
    state.nodes = graph.nodes;
    state.edges = graph.edges;
    state.graphTruncated = graph.truncated;
    renderGraph();
    renderList();
    updateGraphStatus();
    if (state.selected) renderInspector(state.selected, []);
  } catch (error) {
    if (requestId !== state.requestId) return;
    state.nodes = [];
    state.edges = [];
    state.graphTruncated = false;
    renderGraph();
    renderList();
    setStatus(error.code === "VALIDATION_ERROR"
      ? `Validation error: ${errorText(error)}`
      : `Graph unavailable: ${errorText(error)}`, "error");
  }
}

function renderList() {
  const container = getElement("graph-list");
  const { nodes, edges } = visibleGraph();
  container.replaceChildren();
  getElement("graph-viewport").hidden = state.showList;
  container.hidden = !state.showList;
  if (!nodes.length) return;
  const table = document.createElement("table");
  const header = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Kind", "Entity", "Type / scope", "Relationships"].forEach(value => {
    const cell = document.createElement("th");
    cell.textContent = value;
    headerRow.append(cell);
  });
  header.append(headerRow);
  table.append(header);
  const body = document.createElement("tbody");
  const relationshipCounts = new Map();
  edges.forEach(edge => {
    [edge.source, edge.target].forEach(ref => {
      const key = graphRefKey(ref);
      relationshipCounts.set(key, (relationshipCounts.get(key) ?? 0) + 1);
    });
  });
  nodes.forEach(node => {
    const row = document.createElement("tr");
    const kind = document.createElement("td");
    kind.textContent = node.kind.replaceAll("_", " ");
    const entityCell = document.createElement("td");
    const select = document.createElement("button");
    select.type = "button";
    select.textContent = node.label;
    select.dataset.graphNode = "true";
    select.dataset.kind = node.kind;
    select.dataset.id = node.id;
    select.setAttribute("aria-pressed", String(Boolean(state.selected && graphRefKey(state.selected) === graphRefKey(node))));
    select.addEventListener("click", event => selectNode(node, "list", event.currentTarget));
    entityCell.append(select);
    const meta = document.createElement("td");
    meta.textContent = [node.type, node.scope, node.status].filter(Boolean).join(" · ");
    const count = document.createElement("td");
    count.textContent = String(relationshipCounts.get(graphRefKey(node)) ?? 0);
    row.append(kind, entityCell, meta, count);
    body.append(row);
  });
  table.append(body);
  container.append(table);
}

function toggleFocus() {
  if (!state.selected || !state.entityDetails) return;
  state.focused = !state.focused;
  getElement("graph-focus").textContent = state.focused ? "Show full graph" : "Focus neighborhood";
  renderGraph();
  renderList();
  updateGraphStatus();
}

function setupPanAndZoom() {
  const svg = getElement("graph-canvas");
  let drag;
  svg.addEventListener("pointerdown", event => {
    if (event.target.closest(".graph-node")) return;
    drag = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-panning");
  });
  svg.addEventListener("pointermove", event => {
    if (!drag) return;
    const bounds = svg.getBoundingClientRect();
    const delta = graphPanDelta(event.clientX - drag.x, event.clientY - drag.y, bounds.width, bounds.height);
    state.panX = drag.panX + delta.x;
    state.panY = drag.panY + delta.y;
    updateViewport();
  });
  const stopDragging = () => {
    drag = undefined;
    svg.classList.remove("is-panning");
  };
  svg.addEventListener("pointerup", stopDragging);
  svg.addEventListener("pointercancel", stopDragging);
  svg.addEventListener("wheel", event => {
    event.preventDefault();
    state.zoom = Math.max(0.5, Math.min(3, state.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    updateViewport();
  }, { passive: false });
  getElement("graph-zoom-in").addEventListener("click", () => {
    state.zoom = Math.min(3, state.zoom * 1.2);
    updateViewport();
  });
  getElement("graph-zoom-out").addEventListener("click", () => {
    state.zoom = Math.max(0.5, state.zoom / 1.2);
    updateViewport();
  });
  getElement("graph-reset-view").addEventListener("click", () => {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    updateViewport();
  });
}

if (typeof document !== "undefined") {
  getElement("graph-filters").addEventListener("submit", event => {
    event.preventDefault();
    loadGraph();
  });
  getElement("graph-focus").addEventListener("click", toggleFocus);
  getElement("graph-list-toggle").addEventListener("click", event => {
    state.showList = !state.showList;
    event.currentTarget.textContent = state.showList ? "Hide list" : "Show list";
    event.currentTarget.setAttribute("aria-pressed", String(state.showList));
    renderList();
  });
  setupPanAndZoom();
  window.loadKnowledgeGraph = loadGraph;
}
