import type { GraphNodeReference, GraphPosition3D } from "./graph.js";

export function graph3dMotionSettings(prefersReducedMotion: boolean): {
  enableDamping: false;
  autoRotate: false;
  rotateSpeed: number;
};
export function graph3dEdgeStyle(origin: "inferred" | "manual" | "derived"):
  | { color: string }
  | { color: string; dashSize: number; gapSize: number };
export function graphDataUnchanged<TNode, TEdge>(
  previousNodes: TNode[],
  previousEdges: TEdge[],
  nextNodes: TNode[],
  nextEdges: TEdge[],
): boolean;
export function layoutGraphNodes3D(
  nodes: GraphNodeReference[],
  edges: Array<{ source: GraphNodeReference; target: GraphNodeReference }>,
): Map<string, GraphPosition3D>;
