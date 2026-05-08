import type { MemoryEntry } from "@openmembrain/core";
import { renderMemoryDocument, selectExportableMemories } from "./render";
import type { ExportedMemoryFile, MemoryExportOptions, MemoryFileExporter } from "./types";

export class CursorRulesExporter implements MemoryFileExporter {
  readonly target = "cursor" as const;
  readonly path = ".cursor/rules/openmembrain.mdc";

  export(projectId: string, memories: MemoryEntry[], options: MemoryExportOptions = {}): ExportedMemoryFile {
    const content = renderMemoryDocument(projectId, memories, {
      ...options,
      title: "OpenMembrain Cursor Rules",
      intro: "OpenMembrain-generated project memory for Cursor.",
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
