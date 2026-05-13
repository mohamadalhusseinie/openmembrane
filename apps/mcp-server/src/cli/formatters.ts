import type { MemoryEntry } from "@openmembrain/core";
import type { OutputFormat } from "./parseArgs";

export function formatMemories(memories: readonly MemoryEntry[], format: OutputFormat): string {
  if (memories.length === 0) {
    if (format === "json") return "[]";
    return "No memories found.";
  }

  switch (format) {
    case "json":
      return JSON.stringify(
        memories.map((m) => ({
          id: m.id,
          type: m.type,
          scope: m.scope,
          content: m.content,
          confidence: m.confidence,
          tags: m.tags,
          createdAt: m.createdAt
        })),
        null,
        2
      );

    case "markdown":
      return formatMarkdown(memories);

    case "text":
    default:
      return formatText(memories);
  }
}

function formatText(memories: readonly MemoryEntry[]): string {
  const lines: string[] = [];
  lines.push(`Found ${memories.length} memor${memories.length === 1 ? "y" : "ies"}:\n`);

  for (const m of memories) {
    const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
    lines.push(`  [${m.type}] (${m.scope}) ${m.content}${tags}`);
  }

  return lines.join("\n");
}

function formatMarkdown(memories: readonly MemoryEntry[]): string {
  const grouped = new Map<string, MemoryEntry[]>();

  for (const m of memories) {
    const existing = grouped.get(m.type);
    if (existing) {
      existing.push(m);
    } else {
      grouped.set(m.type, [m]);
    }
  }

  const sections: string[] = [];
  for (const [type, entries] of grouped) {
    sections.push(`## ${type.replace(/_/g, " ")}\n`);
    for (const m of entries) {
      sections.push(`- [${m.scope}] ${m.content}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}
