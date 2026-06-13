import { createId, nowIso } from "@openmembrane/shared";
import type {
  Confidence,
  MemoryCandidate,
  MemoryScope,
  MemorySource,
  MemoryType
} from "../types/MemoryCandidate";
import { getSessionText, type SessionInput } from "../types/SessionInput";
import type { MemoryExtractor } from "./MemoryExtractor";

const markerPattern =
  /^\s*(?:[-*]\s*)?(coding rule|remember|memory|rule|architecture|decision|gotcha|testing|deployment|security|forbidden|domain|summary)\s*:\s*(.+)$/i;

const fallbackDurablePattern =
  /\b(this project|the project|we|frontend|backend|database|tests?|deployments?)\b.+\b(uses?|must|requires?|preferred|prefer|do not|never|avoid|forbidden)\b/i;

export class MockMemoryExtractor implements MemoryExtractor {
  async extract(input: SessionInput): Promise<MemoryCandidate[]> {
    const text = getSessionText(input);
    const now = nowIso();
    const candidates: MemoryCandidate[] = [];
    const seen = new Set<string>();

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const markerMatch = line.match(markerPattern);
      if (markerMatch) {
        const marker = markerMatch[1]?.toLowerCase() ?? "memory";
        const content = normalizeContent(markerMatch[2] ?? "");
        this.addCandidate(candidates, seen, input, marker, content, now, "explicit memory marker");
        continue;
      }

      if (fallbackDurablePattern.test(line) && line.length <= 400) {
        const content = normalizeContent(line.replace(/^\s*(user|developer|assistant)\s*:\s*/i, ""));
        this.addCandidate(candidates, seen, input, "memory", content, now, "durable project-specific statement");
      }
    }

    return candidates;
  }

  private addCandidate(
    candidates: MemoryCandidate[],
    seen: Set<string>,
    input: SessionInput,
    marker: string,
    content: string,
    timestamp: string,
    reason: string
  ): void {
    if (!content) {
      return;
    }

    const normalized = content.toLowerCase();
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);

    const source: MemorySource = {
      kind: "session",
      excerpt: content.slice(0, 280)
    };
    if (input.sessionId) {
      source.sessionId = input.sessionId;
    }
    if (input.tool) {
      source.tool = input.tool;
    }

    candidates.push({
      id: createId("cand"),
      projectId: input.projectId,
      type: inferType(marker, content),
      content,
      scope: inferScope(content),
      confidence: inferConfidence(content),
      sensitivity: "internal",
      source,
      reason,
      recommendedAction: "ask_user",
      tags: inferTags(content),
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function inferType(marker: string, content: string): MemoryType {
  if (marker === "architecture" || marker === "decision") {
    return "architecture_decision";
  }
  if (marker === "gotcha") {
    return "known_gotcha";
  }
  if (marker === "testing") {
    return "testing_rule";
  }
  if (marker === "deployment") {
    return "deployment_rule";
  }
  if (marker === "security") {
    return "security_rule";
  }
  if (marker === "forbidden") {
    return "forbidden_pattern";
  }
  if (marker === "domain") {
    return "domain_knowledge";
  }
  if (marker === "summary") {
    return "session_summary";
  }
  if (marker === "rule" || marker === "coding rule") {
    return "coding_rule";
  }

  if (/\b(test|vitest|jest|playwright|mock)\b/i.test(content)) {
    return "testing_rule";
  }
  if (/\b(deploy|deployment|production|flyway|migration)\b/i.test(content)) {
    return "deployment_rule";
  }
  if (/\b(security|auth|jwt|oidc|credential|secret)\b/i.test(content)) {
    return "security_rule";
  }
  if (/\b(do not|never|forbidden|avoid)\b/i.test(content)) {
    return "forbidden_pattern";
  }

  return "project_fact";
}

function inferScope(content: string): MemoryScope {
  if (/\b(frontend|angular|react|vue|component|typescript|dto)\b/i.test(content)) {
    return "frontend";
  }
  if (/\b(backend|api|server|controller|service)\b/i.test(content)) {
    return "backend";
  }
  if (/\b(database|schema|sql|flyway|migration|postgres|mysql)\b/i.test(content)) {
    return "database";
  }
  if (/\b(deploy|deployment|production|runtime environment|container)\b/i.test(content)) {
    return "deployment";
  }
  if (/\b(test|tests|vitest|jest|playwright|mock)\b/i.test(content)) {
    return "testing";
  }
  if (/\b(security|auth|jwt|oidc|secret|credential)\b/i.test(content)) {
    return "security";
  }
  if (/\b(tooling|codex|cursor|copilot|mcp|eslint|prettier)\b/i.test(content)) {
    return "tooling";
  }
  return "global";
}

function inferConfidence(content: string): Confidence {
  if (/\b(maybe|probably|might|could be|i think|seems like|guess)\b/i.test(content)) {
    return "low";
  }
  if (/\b(confirmed|verified|must|required|do not|never|uses|requires?)\b/i.test(content)) {
    return "high";
  }
  return "medium";
}

function inferTags(content: string): string[] {
  const tags = new Set<string>();
  const checks: Array<[string, RegExp]> = [
    ["angular", /\bangular\b/i],
    ["typescript", /\btypescript\b/i],
    ["testing", /\b(test|vitest|jest|playwright)\b/i],
    ["database", /\b(database|schema|sql|flyway|migration)\b/i],
    ["security", /\b(security|auth|jwt|oidc|secret)\b/i],
    ["deployment", /\b(deploy|deployment|production|runtime environment)\b/i],
    ["frontend", /\b(frontend|component|dto)\b/i],
    ["backend", /\b(backend|api|server)\b/i]
  ];

  for (const [tag, pattern] of checks) {
    if (pattern.test(content)) {
      tags.add(tag);
    }
  }

  return [...tags];
}
