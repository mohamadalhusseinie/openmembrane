import type { MemoryEntry } from "@openmembrane/core";
import { renderMemoryDocument, selectExportableMemories } from "./render";
import type { ExportedMemoryFile, MemoryExportOptions, MemoryFileExporter } from "./types";

export class AgentsMdExporter implements MemoryFileExporter {
  readonly target = "agents" as const;
  readonly path = "AGENTS.md";

  export(projectId: string, memories: MemoryEntry[], options: MemoryExportOptions = {}): ExportedMemoryFile {
    const content = renderMemoryDocument(projectId, memories, {
      ...options,
      title: "AGENTS.md",
      intro: "OpenMembrane-generated project memory for AI coding agents."
    });

    return {
      target: this.target,
      path: this.path,
      content,
      memoryCount: selectExportableMemories(memories, options).length
    };
  }
}
