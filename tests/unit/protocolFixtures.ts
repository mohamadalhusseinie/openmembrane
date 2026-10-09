import { resolve } from "node:path";
import type { CollaborationProposal, IngestionResult } from "@openmembrane/core";
import type { EndpointName, EndpointRequest, EndpointResponse } from "@openmembrane/protocol";
import { candidate, entry } from "./helpers";

export const projectRoot = resolve("fixture-project");
const project = { projectRoot, projectId: "project-a", storageDir: resolve("fixture-store"), storageBackend: "sqlite" as const };
export const ingestion: IngestionResult = {
  projectId: "project-a", savedCount: 1, pendingCount: 1, rejectedCount: 1, supersededCount: 1, redactionCount: 1,
  saved: [{ id: "mem_1", type: "coding_rule", scope: "frontend", content: "Use standalone components.", replaces: ["mem_old"] }],
  pending: [{ id: "cand_2", type: "architecture_decision", scope: "backend", content: "Use queues.", recommendedAction: "ask_user", conflictWith: ["mem_3"] }],
  rejected: [{ id: "cand_3", type: "project_fact", rejectionReason: "Duplicate", duplicateOf: "mem_4" }],
  superseded: [{ id: "mem_old", supersededBy: "mem_1" }],
};
const { source: _source, ...sharedMemory } = entry();
export const proposal: CollaborationProposal = {
  projectId: "project-a", memory: sharedMemory, state: "proposed", operation: "upsert", removalMemoryIds: ["mem_old"],
  review: { provider: "github", id: "123", url: "https://github.com/example/memory/pull/123", branch: "proposal", mergedAt: "2026-05-08", mergedCommit: "abc", closedAt: "2026-05-09", closedBy: "owner" },
  retry: { status: "scheduled", attempts: 2, lastAttemptAt: "2026-05-08", nextAttemptAt: "2026-05-09", failureCode: "GITHUB_PUBLICATION_FAILED" },
  createdAt: "2026-05-08", updatedAt: "2026-05-08",
};

export const protocolFixtures: { [K in EndpointName]: { request: EndpointRequest<K>; response: EndpointResponse<K> } } = {
  remember: { request: { ...project, items: [{ content: "Use standalone components.", type: "coding_rule", scope: "frontend", confidence: "high", tags: ["angular"] }] }, response: ingestion },
  ingest: { request: { ...project, transcript: "Rule: Use standalone components.", summary: "Angular project", tool: "copilot", sessionId: "session-1", metadata: { count: 1, complete: true, label: "test" } }, response: { ...ingestion, proposalCount: 1, proposals: [{ memoryId: "mem_1", state: "retry_scheduled", nextAttemptAt: "2026-05-09" }] } },
  getProjectRules: { request: { ...project, scope: "frontend", limit: 20 }, response: { rules: [entry()], pendingCandidateCount: 1 } },
  getRelevantContext: { request: { ...project, query: "Angular", scope: "frontend", limit: 10 }, response: { memories: [{ ...entry(), conflicts: [{ memoryId: "mem_2", kind: "alternative" }] }], pendingCandidateCount: 1 } },
  searchMemory: { request: { ...project, query: "Angular", types: ["coding_rule"], scopes: ["frontend"], tags: ["angular"], limit: 20 }, response: [entry()] },
  listMemoryCandidates: { request: { ...project, limit: 30 }, response: [candidate({ rejectionReason: "test", duplicateOf: "mem_old", conflictWith: ["mem_old"] })] },
  approveMemoryCandidate: { request: { ...project, candidateId: "cand_1" }, response: { ...entry(), kind: "published", proposal } },
  rejectMemoryCandidate: { request: { ...project, candidateId: "cand_1", reason: "Obsolete" }, response: { projectId: "project-a", candidateId: "cand_1", rejected: true } },
  approveAllCandidates: { request: project, response: { projectId: "project-a", approved: [entry(), { ...entry(), kind: "retry_deferred", nextAttemptAt: "2026-05-09" }], skipped: [{ candidateId: "cand_2", reason: "Secret" }] } },
  rejectAllCandidates: { request: { ...project, reason: "Obsolete" }, response: { projectId: "project-a", rejectedCount: 2 } },
  updateMemory: { request: { ...project, memoryId: "mem_1", content: "New content", type: "project_fact", scope: "tooling", tags: ["tag"] }, response: { ...entry(), kind: "retry_scheduled", code: "GITHUB_PUBLICATION_FAILED", nextAttemptAt: "2026-05-09" } },
  supersedeMemory: { request: { ...project, memoryId: "mem_1", replacementId: "mem_2", reason: "Obsolete" }, response: { ...entry({ status: "superseded", supersededBy: "mem_2", supersededAt: "2026-05-09" }), kind: "rejected", code: "GITHUB_MEMORY_INVALID", message: "Invalid memory" } },
  reviewStaleMemories: { request: { ...project, staleAfterMonths: 12 }, response: [entry()] },
  exportStaticMemoryFiles: { request: { ...project, targets: ["agents", "claude", "copilot", "cursor", "project_memory"], outputDir: "docs", includeConfidential: true }, response: { projectId: "project-a", files: [{ target: "agents", path: "AGENTS.md", content: "Project instructions", memoryCount: 1 }] } },
  getDiagnostics: { request: { ...project, severity: "warning", code: "EXTRACTION_PROVIDER_ERROR", limit: 500 }, response: [{ id: "diag_1", projectId: "project-a", severity: "warning", code: "EXTRACTION_PROVIDER_ERROR", message: "Extraction failed", operation: "ingest", source: "core", entityId: "session_1", createdAt: "2026-05-08", details: { count: 1 } }] },
  listAuditLog: { request: { ...project, limit: 500 }, response: [{ id: "audit_1", projectId: "project-a", type: "memory_saved", entityId: "mem_1", createdAt: "2026-05-08", details: { manual: true } }] },
  health: { request: {}, response: {} },
  configureGitHubTeamMode: { request: { ...project, repository: { host: "github.com", owner: "example", name: "memory" } }, response: { kind: "configured", config: { projectId: "project-a", mode: "github_team", repository: { host: "github.com", owner: "example", name: "memory", defaultBranch: "main" }, checkoutPath: resolve("checkout"), repositoryInitialized: true, createdAt: "2026-05-08", updatedAt: "2026-05-08" } } },
  getCollaborationStatus: { request: project, response: { mode: "github_team", repository: { host: "github.com", owner: "example", name: "memory", defaultBranch: "main" }, proposals: { proposed: 1, active: 2, rejected: 0, syncFailed: 1, conflict: 0 }, retries: [{ memoryId: "mem_1", attempts: 2, nextAttemptAt: "2026-05-09" }] } },
};
