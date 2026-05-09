export interface Dedupable {
  id: string;
  content: string;
}

export class Deduplicator {
  findDuplicate<T extends Dedupable>(candidate: Dedupable, existing: T[]): T | undefined {
    const candidateNormalized = normalizeMemoryContent(candidate.content);

    return existing.find((memory) => {
      const memoryNormalized = normalizeMemoryContent(memory.content);
      return memoryNormalized === candidateNormalized || tokenSimilarity(memoryNormalized, candidateNormalized) >= 0.9;
    });
  }
}

export function normalizeMemoryContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[`"'.,;:!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 2));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}
