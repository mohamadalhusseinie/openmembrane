import type { MemoryEntry, MemoryType } from "@openmembrain/core";
import type { MemoryExportOptions } from "./types";

const usagePreamble = `## Using OpenMemBrain

If OpenMemBrain MCP tools are available in your environment:

- **Session start:** Call \`get_project_rules\` and \`get_relevant_context\` to load
  project memory before starting work.
- **Session end:** Call \`propose_memory_from_session\` with a summary of durable
  knowledge discovered during the session. Use prefixes like \`rule:\`,
  \`architecture:\`, \`gotcha:\`, \`testing:\`, \`security:\`, \`forbidden:\`, \`remember:\`
  to help extraction.
- **Review:** Call \`list_memory_candidates\` to review and approve/reject pending
  memories.

The memories below were exported from OpenMemBrain for tools without MCP access.
`;

const typeLabels: Record<MemoryType, string> = {
  project_fact: "Project Facts",
  coding_rule: "Coding Rules",
  architecture_decision: "Architecture Decisions",
  known_gotcha: "Known Gotchas",
  testing_rule: "Testing Rules",
  deployment_rule: "Deployment Rules",
  security_rule: "Security Rules",
  forbidden_pattern: "Forbidden Patterns",
  domain_knowledge: "Domain Knowledge",
  session_summary: "Session Summaries"
};

const typeOrder: MemoryType[] = [
  "coding_rule",
  "architecture_decision",
  "forbidden_pattern",
  "testing_rule",
  "deployment_rule",
  "security_rule",
  "known_gotcha",
  "project_fact",
  "domain_knowledge",
  "session_summary"
];

export interface RenderMemoryDocumentOptions extends MemoryExportOptions {
  title: string;
  intro: string;
  cursorFrontmatter?: boolean;
}

export function renderMemoryDocument(
  projectId: string,
  memories: MemoryEntry[],
  options: RenderMemoryDocumentOptions
): string {
  const exportable = selectExportableMemories(memories, options);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const lines: string[] = [];

  if (options.cursorFrontmatter) {
    lines.push("---", "description: OpenMembrain project memory", "alwaysApply: true", "---", "");
  }

  lines.push(`# ${options.title}`, "");
  lines.push(options.intro, "");
  lines.push(`Project: ${projectId}`, `Generated: ${generatedAt}`, "");

  lines.push(usagePreamble);

  if (!options.includeConfidential) {
    lines.push("> Confidential memories are excluded from this static fallback file by default.", "");
  }

  if (exportable.length === 0) {
    lines.push("No exportable OpenMembrain memory has been saved yet.", "");
    return lines.join("\n");
  }

  for (const type of typeOrder) {
    const group = exportable.filter((memory) => memory.type === type);
    if (group.length === 0) {
      continue;
    }

    lines.push(`## ${typeLabels[type]}`, "");
    for (const memory of group.sort(compareMemories)) {
      lines.push(`- [${memory.scope}] ${memory.content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function selectExportableMemories(memories: MemoryEntry[], options: MemoryExportOptions = {}): MemoryEntry[] {
  return memories.filter((memory) => {
    if (memory.sensitivity === "confidential" && !options.includeConfidential) {
      return false;
    }
    return memory.status === "active";
  });
}

function compareMemories(left: MemoryEntry, right: MemoryEntry): number {
  return left.scope.localeCompare(right.scope) || left.content.localeCompare(right.content);
}
