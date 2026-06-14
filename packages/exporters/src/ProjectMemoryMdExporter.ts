import type { MemoryEntry } from "@openmembrane/core";
import { renderMemoryDocument, selectExportableMemories } from "./render";
import type { ExportedMemoryFile, MemoryExportOptions, MemoryFileExporter } from "./types";

export class ProjectMemoryMdExporter implements MemoryFileExporter {
  readonly target = "project_memory" as const;
  readonly path = "docs/ai/project-memory.md";

  export(projectId: string, memories: MemoryEntry[], options: MemoryExportOptions = {}): ExportedMemoryFile {
    const content = renderMemoryDocument(projectId, memories, {
      ...options,
      title: "Project AI Memory",
      intro: "Human-readable OpenMembrane project memory export."
    });

    return {
      target: this.target,
      path: this.path,
      content,
      memoryCount: selectExportableMemories(memories, options).length
    };
  }
}
