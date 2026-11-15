import { createServer } from "node:http";
import { serveStatic } from "../apps/review-ui/src/static.ts";

const nodes = Array.from({ length: 500 }, (_, index) => {
  const kinds = ["memory", "candidate", "session", "tag", "audit_event", "diagnostic"];
  const kind = kinds[index % kinds.length];
  return {
    kind,
    id: `${kind}-preview-${String(index + 1).padStart(3, "0")}`,
    label: `${kind.replaceAll("_", " ")} ${String(index + 1).padStart(3, "0")}: local graph fixture`,
    content: `Synthetic ${kind.replaceAll("_", " ")} node for exploring graph connections. No project data is loaded.`,
    summary: "Generated locally for the optional 3D graph preview.",
    type: index % 2 ? "project_fact" : "coding_rule",
    scope: index % 3 ? "project" : "global",
    status: kind === "candidate" ? "pending" : "active",
    sensitivity: "internal",
    confidence: 0.8,
    tags: [`fixture-${index % 12}`, `group-${Math.floor(index / 50)}`],
    createdAt: new Date(Date.UTC(2026, 0, 1 + index % 28)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 1, 1 + index % 28)).toISOString(),
  };
});

const relationshipTypes = ["related_to", "supports", "depends_on", "conflicts_with", "derived_from", "tagged_with"];
const origins = ["inferred", "manual", "derived"];
const edges = [];
for (let index = 0; index < nodes.length; index += 1) {
  for (const offset of [1, 37]) {
    const target = nodes[(index + offset) % nodes.length];
    edges.push({
      id: `preview-relationship-${edges.length + 1}`,
      source: { kind: nodes[index].kind, id: nodes[index].id },
      target: { kind: target.kind, id: target.id },
      type: relationshipTypes[(index + offset) % relationshipTypes.length],
      origin: origins[(index + offset) % origins.length],
      confidence: 0.7 + (index % 3) * 0.1,
      rationale: `Synthetic fixture connection ${index + 1} to ${((index + offset) % nodes.length) + 1}.`,
      createdAt: new Date(Date.UTC(2026, 2, 1 + index % 28)).toISOString(),
    });
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function graphFor(query) {
  const search = (query.get("search") ?? "").toLowerCase();
  const kinds = query.getAll("kind");
  const relationshipTypesFilter = query.getAll("relationshipType");
  const visibleNodes = nodes.filter(node =>
    (!kinds.length || kinds.includes(node.kind)) &&
    (!search || `${node.label} ${node.content} ${node.tags.join(" ")}`.toLowerCase().includes(search)),
  );
  const visibleKeys = new Set(visibleNodes.map(node => JSON.stringify([node.kind, node.id])));
  const visibleEdges = edges.filter(edge =>
    visibleKeys.has(JSON.stringify([edge.source.kind, edge.source.id])) &&
    visibleKeys.has(JSON.stringify([edge.target.kind, edge.target.id])) &&
    (!relationshipTypesFilter.length || relationshipTypesFilter.includes(edge.type)),
  );
  return { nodes: visibleNodes, edges: visibleEdges, truncated: false };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/api/memories") {
    sendJson(response, 200, []);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/graph") {
    sendJson(response, 200, graphFor(url.searchParams));
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/api/graph/entities/")) {
    const [, , , , kind, id] = url.pathname.split("/");
    const node = nodes.find(item => item.kind === decodeURIComponent(kind ?? "") && item.id === decodeURIComponent(id ?? ""));
    if (!node) {
      sendJson(response, 404, { error: "Synthetic graph entity not found." });
      return;
    }
    const linkedEdges = edges.filter(edge =>
      (edge.source.kind === node.kind && edge.source.id === node.id) ||
      (edge.target.kind === node.kind && edge.target.id === node.id),
    );
    const neighborKeys = new Set(linkedEdges.flatMap(edge => [
      JSON.stringify([edge.source.kind, edge.source.id]),
      JSON.stringify([edge.target.kind, edge.target.id]),
    ]));
    neighborKeys.delete(JSON.stringify([node.kind, node.id]));
    const neighbors = nodes.filter(item => neighborKeys.has(JSON.stringify([item.kind, item.id])));
    sendJson(response, 200, { entity: node, neighbors, edges: linkedEdges, truncated: false });
    return;
  }
  if (request.method === "POST" && url.pathname.startsWith("/api/")) {
    sendJson(response, 501, { error: "Writes are disabled in this synthetic preview.", code: "PREVIEW_ONLY" });
    return;
  }

  const staticResult = await serveStatic(url.pathname);
  response.writeHead(staticResult.status, staticResult.headers ?? {});
  if (Buffer.isBuffer(staticResult.body)) response.end(staticResult.body);
  else response.end(JSON.stringify(staticResult.body));
});

const requestedPort = Number(process.argv[2] ?? 61327);
server.listen(requestedPort, "127.0.0.1", () => {
  const { port } = server.address();
  process.stdout.write(`Synthetic 500-node Knowledge Graph preview: http://127.0.0.1:${port}/\n`);
  process.stdout.write("No daemon or project memory store is connected; graph mutations are disabled.\n");
});
