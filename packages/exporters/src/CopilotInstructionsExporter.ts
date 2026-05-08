import type { MemoryEntry } from "@openmembrain/core";
import { renderMemoryDocument, selectExportableMemories } from "./render";
import type { ExportedMemoryFile, MemoryExportOptions, MemoryFileExporter } from "./types";

export class CopilotInstructionsExporter implements MemoryFileExporter {
  readonly target = "copilot" as const;
  readonly path = ".github/copilot-instructions.md";

  export(projectId: string, memories: MemoryEntry[], options: MemoryExportOptions = {}): ExportedMemoryFile {
    const content = renderMemoryDocument(projectId, memories, {
      ...options,
      title: "GitHub Copilot Instructions",
      intro: "OpenMembrain-generated project memory for GitHub Copilot."
    });

    return {
      target: this.target,
      path: this.path,
      content,
      memoryCount: selectExportableMemories(memories, options).length
    };
  }
}
