import type { DiagnosticSeverity } from "../diagnostics/Diagnostics";
import type { AuditEvent } from "../types/Storage";
import type { Confidence, MemoryScope, MemoryType, RecommendedAction, Sensitivity } from "../types/MemoryCandidate";
import type { MemoryStatus } from "../types/MemoryEntry";
import type { EntityKind, EntityRef, Relationship, RelationshipType } from "./Relationship";

export interface KnowledgeGraphNode {
  id: string;
  kind: EntityKind;
  label: string;
  summary?: string;
  content?: string;
  type?: MemoryType;
  scope?: MemoryScope;
  status?: MemoryStatus;
  sensitivity?: Exclude<Sensitivity, "secret">;
  confidence?: Confidence;
  recommendedAction?: RecommendedAction;
  severity?: DiagnosticSeverity;
  eventType?: AuditEvent["type"];
  sourceTool?: string;
  sourceExcerpt?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type KnowledgeGraphEdge = Omit<Relationship, "projectId">;

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  truncated: boolean;
}

export interface KnowledgeGraphQuery {
  search?: string;
  entityKinds?: EntityKind[];
  relationshipTypes?: RelationshipType[];
  limit?: number;
}

export interface KnowledgeGraphEntity {
  entity: KnowledgeGraphNode;
  edges: KnowledgeGraphEdge[];
  neighbors: KnowledgeGraphNode[];
  truncated: boolean;
}

export type KnowledgeGraphEntityRef = EntityRef;
