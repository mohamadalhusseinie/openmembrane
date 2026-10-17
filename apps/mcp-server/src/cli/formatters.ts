import type { MemoryEntry } from "@openmembrane/core";
import type { OutputFormat } from "./parseArgs";

type FormattedMemory = Pick<MemoryEntry, "id" | "type" | "scope" | "content" | "confidence" | "tags" | "createdAt">;

export function formatResult(value: unknown, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(value, null, 2);
  if (format === "markdown") return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
  return formatValue(value, "");
}

function formatValue(value: unknown, indent: string): string {
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.map((item) => `${indent}- ${formatValue(item, indent + "  ")}`).join("\n");
  if (value !== null && typeof value === "object") {
    return Object.entries(value).map(([key, item]) =>
      item !== null && typeof item === "object"
        ? `${indent}${key}:\n${formatValue(item, indent + "  ")}`
        : `${indent}${key}: ${String(item)}`
    ).join("\n");
  }
  return String(value);
}

export function formatMemories(memories: readonly FormattedMemory[], format: OutputFormat): string {
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

function formatText(memories: readonly FormattedMemory[]): string {
  const lines: string[] = [];
  lines.push(`Found ${memories.length} memor${memories.length === 1 ? "y" : "ies"}:\n`);

  for (const m of memories) {
    const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
    lines.push(`  [${m.type}] (${m.scope}) ${m.content}${tags}`);
  }

  return lines.join("\n");
}

function formatMarkdown(memories: readonly FormattedMemory[]): string {
  const grouped = new Map<string, FormattedMemory[]>();

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
