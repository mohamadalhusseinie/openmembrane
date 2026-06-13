import type { MemoryEntry } from "@openmembrane/core";
import { renderMemoryDocument, selectExportableMemories } from "./render";
import type { ExportedMemoryFile, MemoryExportOptions, MemoryFileExporter } from "./types";

export class CursorRulesExporter implements MemoryFileExporter {
  readonly target = "cursor" as const;
  readonly path = ".cursor/rules/openmembrane.mdc";

  export(projectId: string, memories: MemoryEntry[], options: MemoryExportOptions = {}): ExportedMemoryFile {
    const content = renderMemoryDocument(projectId, memories, {
      ...options,
      title: "OpenMembrane Cursor Rules",
      intro: "OpenMembrane-generated project memory for Cursor.",
      cursorFrontmatter: true
    });

    return {
      target: this.target,
      path: this.path,
      content,
      memoryCount: selectExportableMemories(memories, options).length
    };
  }
}
