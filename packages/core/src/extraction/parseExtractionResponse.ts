import { createId, nowIso } from "@openmembrane/shared";
import {
  confidenceValues,
  memoryScopes,
  memoryTypes,
  recommendedActions,
  sensitivityValues,
  type Confidence,
  type MemoryCandidate,
  type MemoryScope,
  type MemorySource,
  type MemoryType,
  type RecommendedAction,
  type Sensitivity,
} from "../types/MemoryCandidate";

function safeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export interface ParseExtractionOptions {
  sessionId?: string | undefined;
  tool?: string | undefined;
}

export function parseExtractionResponse(
  raw: string,
  projectId: string,
  options?: ParseExtractionOptions,
): MemoryCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  let items: unknown[];

  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const arrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    if (arrayKey) {
      items = obj[arrayKey] as unknown[];
    } else {
      return [];
    }
  } else {
    return [];
  }

  const results: MemoryCandidate[] = [];

  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;

    if (typeof rec.content !== "string" || rec.content.length === 0) continue;

    const now = nowIso();
    const source: MemorySource = { kind: "session" };
    if (options?.sessionId !== undefined) {
      source.sessionId = options.sessionId;
    }
    if (options?.tool !== undefined) {
      source.tool = options.tool;
    }

    results.push({
      id: createId("cand"),
      projectId,
      type: safeEnum(rec.type, memoryTypes, "project_fact"),
      content: rec.content,
      scope: safeEnum(rec.scope, memoryScopes, "unknown"),
      confidence: safeEnum(rec.confidence, confidenceValues, "medium"),
      sensitivity: safeEnum(rec.sensitivity, sensitivityValues, "internal"),
      source,
      reason:
        typeof rec.reason === "string" ? rec.reason : "Extracted by LLM",
      recommendedAction: safeEnum(
        rec.recommendedAction,
        recommendedActions,
        "ask_user",
      ),
      tags:
        Array.isArray(rec.tags) && rec.tags.every((t) => typeof t === "string")
          ? (rec.tags as string[])
          : [],
      createdAt: now,
      updatedAt: now,
    });
  }

  return results;
}
