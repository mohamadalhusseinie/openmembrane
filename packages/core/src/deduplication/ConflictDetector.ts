import { normalizeMemoryContent } from "./Deduplicator";
import type { MemoryCandidate } from "../types/MemoryCandidate";
import type { MemoryEntry } from "../types/MemoryEntry";

export class ConflictDetector {
  findConflicts(candidate: MemoryCandidate, existing: MemoryEntry[]): MemoryEntry[] {
    const candidateTokens = importantTokens(candidate.content);
    const candidateNegated = hasNegation(candidate.content);

    return existing.filter((memory) => {
      if (memory.projectId !== candidate.projectId) {
        return false;
      }
      if (memory.scope !== candidate.scope && memory.scope !== "global" && candidate.scope !== "global") {
        return false;
      }

      const memoryTokens = importantTokens(memory.content);
      const overlap = tokenOverlap(candidateTokens, memoryTokens);
      const memoryNegated = hasNegation(memory.content);

      if (
        overlap >= 0.45 &&
        candidateNegated !== memoryNegated &&
        !mentionsDifferentAlternatives(candidate.content, memory.content)
      ) {
        return true;
      }

      return hasAlternativeConflict(candidate.content, memory.content, candidateTokens, memoryTokens);
    });
  }
}

const alternativeGroups: string[][][] = [
  [["angular"], ["react"], ["vue"], ["svelte"]],
  [["tabs"], ["spaces"]],
  [["docker", "container", "containers"], ["bare metal", "bare-metal"]],
  [["runtime environment"], ["compile time", "compile-time"]],
  [["npm"], ["pnpm"], ["yarn"], ["bun"]]
];

function hasNegation(content: string): boolean {
  return /\b(do not|don't|never|forbidden|avoid|must not|disable)\b/i.test(content);
}

function importantTokens(content: string): Set<string> {
  const stopWords = new Set([
    "this",
    "that",
    "with",
    "from",
    "should",
    "must",
    "uses",
    "use",
    "using",
    "project",
    "rule",
    "the",
    "and",
    "for",
    "not"
  ]);

  return new Set(
    normalizeMemoryContent(content)
      .split(" ")
      .filter((token) => token.length > 3 && !stopWords.has(token))
  );
}

function hasAlternativeConflict(
  candidateContent: string,
  memoryContent: string,
  candidateTokens: Set<string>,
  memoryTokens: Set<string>
): boolean {
  if (hasNegation(candidateContent) || hasNegation(memoryContent)) {
    return false;
  }

  if (!hasSharedContext(candidateTokens, memoryTokens) && !hasMatchingDirective(candidateContent, memoryContent)) {
    return false;
  }

  if (hasDifferentNodeVersion(candidateContent, memoryContent)) {
    return true;
  }

  return alternativeGroups.some((group) => hasDifferentAlternatives(candidateContent, memoryContent, group));
}

function hasSharedContext(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((token) => right.has(token));
}

function hasMatchingDirective(left: string, right: string): boolean {
  return hasDirective(left) && hasDirective(right);
}

function hasDirective(content: string): boolean {
  return /\b(use|uses|target|deploy|prefer|preferred|always)\b/i.test(content);
}

function hasDifferentAlternatives(left: string, right: string, alternatives: string[][]): boolean {
  const leftAlternatives = foundAlternatives(left, alternatives);
  const rightAlternatives = foundAlternatives(right, alternatives);

  if (leftAlternatives.size === 0 || rightAlternatives.size === 0) {
    return false;
  }

  return ![...leftAlternatives].some((alternative) => rightAlternatives.has(alternative));
}

function mentionsDifferentAlternatives(left: string, right: string): boolean {
  return alternativeGroups.some((group) => {
    const leftAlternatives = foundMentionedAlternatives(left, group);
    const rightAlternatives = foundMentionedAlternatives(right, group);

    return (
      leftAlternatives.size > 0 &&
      rightAlternatives.size > 0 &&
      ![...leftAlternatives].some((alternative) => rightAlternatives.has(alternative))
    );
  });
}

function foundAlternatives(content: string, alternatives: string[][]): Set<number> {
  const found = new Set<number>();
  alternatives.forEach((terms, index) => {
    if (terms.some((term) => hasTerm(content, term) && !hasRejectedTerm(content, term))) {
      found.add(index);
    }
  });
  return found;
}

function foundMentionedAlternatives(content: string, alternatives: string[][]): Set<number> {
  const found = new Set<number>();
  alternatives.forEach((terms, index) => {
    if (terms.some((term) => hasTerm(content, term))) {
      found.add(index);
    }
  });
  return found;
}

function hasDifferentNodeVersion(left: string, right: string): boolean {
  const leftVersion = nodeVersion(left);
  const rightVersion = nodeVersion(right);
  return leftVersion !== undefined && rightVersion !== undefined && leftVersion !== rightVersion;
}

function nodeVersion(content: string): string | undefined {
  return normalizeTermText(content).match(/\bnode(?:\s+js)?\s+v?(\d+)\b/)?.[1];
}

function hasTerm(content: string, term: string): boolean {
  const normalizedTerm = escapeRegex(normalizeTermText(term));
  return new RegExp(`\\b${normalizedTerm.replace(/\\s+/g, "\\s+")}\\b`).test(normalizeTermText(content));
}

function hasRejectedTerm(content: string, term: string): boolean {
  const normalizedTerm = escapeRegex(normalizeTermText(term));
  const pattern = normalizedTerm.replace(/\\s+/g, "\\s+");
  return new RegExp(`\\b(instead of|rather than|not)\\s+${pattern}\\b`).test(normalizeTermText(content));
}

function normalizeTermText(content: string): string {
  return normalizeMemoryContent(content).replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.min(left.size, right.size);
}
