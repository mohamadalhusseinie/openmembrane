export interface GraphNodeReference {
  kind: string;
  id: string;
}

export interface GraphPosition {
  x: number;
  y: number;
}

export function graphRefKey(ref: GraphNodeReference): string;
export function buildGraphQuery(search: string, kinds: string[], relationshipTypes: string[]): string;
export function layoutGraphNodes(nodes: GraphNodeReference[]): Map<string, GraphPosition>;
