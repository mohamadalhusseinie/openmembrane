import type { MemoryEntry } from "@openmembrain/core";

export type ExportTarget = "agents" | "claude" | "copilot" | "cursor" | "project_memory";

export interface MemoryExportOptions {
  includeConfidential?: boolean;
  generatedAt?: string;
}

export interface ExportedMemoryFile {
  target: ExportTarget;
  path: string;
  content: string;
  memoryCount: number;
}

export interface MemoryFileExporter {
  readonly target: ExportTarget;
  readonly path: string;
  export(projectId: string, memories: MemoryEntry[], options?: MemoryExportOptions): ExportedMemoryFile;
}
