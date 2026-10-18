import { createHash } from "node:crypto";
import type { MemoryCandidate } from "../types/MemoryCandidate";
import type { AuditEvent } from "../types/Storage";

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

export function sessionCandidateFingerprint(candidate: MemoryCandidate): string | undefined {
  const { source } = candidate;
  if (source.kind !== "session" || (!source.sessionId && !source.transcriptHash)) return undefined;
  const origin = source.sessionId ? ["session", source.sessionId] : ["transcript", source.transcriptHash];
  return createHash("sha256")
    .update(JSON.stringify([source.tool ?? null, origin, normalizeMemoryContent(candidate.content)]))
    .digest("hex");
}

export function processedSessionFingerprint(event: AuditEvent): string | undefined {
  const fingerprint = event.details?.sessionFingerprint;
  if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) return undefined;
  const processed = event.type === "memory_saved" || (event.type === "candidate_rejected" &&
    (event.details?.rejectedByUser === true || event.details?.processedSession === true));
  return processed ? fingerprint : undefined;
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
