import { createOpenMembrainContext, resolveProjectId } from "../context";
import { rankMemories } from "@openmembrain/core";
import type { MemoryEntry, MemoryScope, MemoryType } from "@openmembrain/core";
import type { ContextCommand } from "./parseArgs";
import { formatMemories } from "./formatters";
import { printPendingReminder } from "./pendingReminder";

export async function runContext(cmd: ContextCommand): Promise<void> {
  const context = createOpenMembrainContext();
  try {
    const projectId = resolveProjectId(context, cmd.project);

    let memories: MemoryEntry[];

    if (cmd.query) {
      memories = await context.memoryStore.search(projectId, cmd.query, {
        ...(cmd.type ? { types: [cmd.type as MemoryType] } : {}),
        ...(cmd.scope ? { scopes: [cmd.scope as MemoryScope] } : {})
      });
    } else {
      memories = await context.memoryStore.list(projectId);
    }

    // Filter by type/scope if specified (search already handles this, but list does not)
    if (!cmd.query) {
      if (cmd.type) {
        memories = memories.filter((m) => m.type === cmd.type);
      }
      if (cmd.scope) {
        memories = memories.filter((m) => m.scope === cmd.scope);
      }
    }

    // Filter out superseded
    memories = memories.filter((m) => m.status === "active");

    // Rank by relevance if query provided
    if (cmd.query && memories.length > 0) {
      const scored = rankMemories(memories, cmd.query, "context");
      memories = scored.map((s) => s.entry);
    }

    const output = formatMemories(memories, cmd.output);
    process.stdout.write(output + "\n");
    await printPendingReminder(context.pendingCandidateStore, projectId);
  } finally {
    context.close?.();
  }
}
