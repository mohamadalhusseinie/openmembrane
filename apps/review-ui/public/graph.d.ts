export interface GraphNodeReference {
  kind: string;
  id: string;
}

export interface GraphPosition {
  x: number;
  y: number;
}

export interface GraphEdgePresentation {
  source: GraphNodeReference;
  target: GraphNodeReference;
  type: string;
  origin: "inferred" | "manual" | "derived";
  confidence: number;
  rationale: string;
  createdAt?: string;
}

export function graphRefKey(ref: GraphNodeReference): string;
export function buildGraphQuery(search: string, kinds: string[], relationshipTypes: string[]): string;
export function layoutGraphNodes(nodes: GraphNodeReference[]): Map<string, GraphPosition>;
export function graphEdgeClass(edge: Pick<GraphEdgePresentation, "type" | "origin">): string;
export function graphRelationshipDescription(
  edge: GraphEdgePresentation,
  node: GraphNodeReference,
): { label: string; provenance: string; rationale: string; createdAt: string | undefined };
export function graphEdgeCoordinates(
  edge: { source: GraphNodeReference; target: GraphNodeReference },
  positions: Map<string, GraphPosition>,
  selected?: GraphNodeReference,
): { x1: number; y1: number; x2: number; y2: number } | undefined;
export function graphPanDelta(
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
): { x: number; y: number };
export function graphStatus(
  nodeCount: number,
  edgeCount: number,
  truncated: boolean,
): { message: string; kind: "" | "empty" };
export function updateGraphListSelection(
  buttons: ArrayLike<{ dataset: { kind?: string; id?: string }; setAttribute(name: string, value: string): void }>,
  selected?: GraphNodeReference,
): void;
