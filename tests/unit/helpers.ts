import type { MemoryCandidate, MemoryEntry } from "@openmembrane/core";

export function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: "cand_1",
    projectId: "project-a",
    type: "coding_rule",
    content: "This project uses standalone components.",
    scope: "frontend",
    confidence: "high",
    sensitivity: "internal",
    source: { kind: "session" },
    reason: "test",
    recommendedAction: "auto_save",
    tags: [],
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
    ...overrides
  };
}

export function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "mem_1",
    projectId: "project-a",
    type: "coding_rule",
    content: "This project uses standalone components.",
    scope: "frontend",
    confidence: "high",
    sensitivity: "internal",
    source: { kind: "session" },
    reason: "test",
    tags: [],
    status: "active",
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
    ...overrides
  };
}
