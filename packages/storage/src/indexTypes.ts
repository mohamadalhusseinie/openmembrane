import type { Confidence, MemoryScope, MemoryType } from "@openmembrain/core";

export interface MasterIndex {
  version: number;
  lastUpdated: string;
  totalCount: number;
  byType: Record<string, { count: number; scopes: string[] }>;
  byScope: Record<string, { count: number; types: string[] }>;
}

export interface TypeIndexEntry {
  id: string;
  projectId: string;
  scope: MemoryScope;
  content: string;
  confidence: Confidence;
  tags: string[];
  updatedAt: string;
}

export interface TypeIndex {
  type: MemoryType;
  count: number;
  lastUpdated: string;
  entries: TypeIndexEntry[];
}

export function emptyMasterIndex(): MasterIndex {
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    totalCount: 0,
    byType: {},
    byScope: {},
  };
}

export function emptyTypeIndex(type: MemoryType): TypeIndex {
  return {
    type,
    count: 0,
    lastUpdated: new Date().toISOString(),
    entries: [],
  };
}
