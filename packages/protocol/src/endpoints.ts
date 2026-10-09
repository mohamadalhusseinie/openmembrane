import type { z } from "zod";
import * as s from "./schemas";

export const endpoints = {
  remember: { method: "POST", path: "/v1/remember", projectScoped: true, request: s.rememberRequestSchema, response: s.ingestionResponseSchema },
  ingest: { method: "POST", path: "/v1/ingest", projectScoped: true, request: s.ingestRequestSchema, response: s.ingestionResponseSchema },
  getProjectRules: { method: "POST", path: "/v1/context/rules", projectScoped: true, request: s.rulesRequestSchema, response: s.rulesResponseSchema },
  getRelevantContext: { method: "POST", path: "/v1/context/query", projectScoped: true, request: s.contextRequestSchema, response: s.contextResponseSchema },
  searchMemory: { method: "POST", path: "/v1/search", projectScoped: true, request: s.searchRequestSchema, response: s.searchResponseSchema },
  listMemoryCandidates: { method: "GET", path: "/v1/candidates", projectScoped: true, request: s.candidatesRequestSchema, response: s.candidatesResponseSchema },
  approveMemoryCandidate: { method: "POST", path: "/v1/candidates/:id/approve", idField: "candidateId", projectScoped: true, request: s.approveCandidateRequestSchema, response: s.approveCandidateResponseSchema },
  rejectMemoryCandidate: { method: "POST", path: "/v1/candidates/:id/reject", idField: "candidateId", projectScoped: true, request: s.rejectCandidateRequestSchema, response: s.rejectCandidateResponseSchema },
  approveAllCandidates: { method: "POST", path: "/v1/candidates/approve-all", projectScoped: true, request: s.approveAllRequestSchema, response: s.approveAllResponseSchema },
  rejectAllCandidates: { method: "POST", path: "/v1/candidates/reject-all", projectScoped: true, request: s.rejectAllRequestSchema, response: s.rejectAllResponseSchema },
  updateMemory: { method: "PATCH", path: "/v1/memory/:id", idField: "memoryId", projectScoped: true, request: s.updateMemoryRequestSchema, response: s.updateMemoryResponseSchema },
  supersedeMemory: { method: "POST", path: "/v1/memory/:id/supersede", idField: "memoryId", projectScoped: true, request: s.supersedeMemoryRequestSchema, response: s.supersedeMemoryResponseSchema },
  reviewStaleMemories: { method: "GET", path: "/v1/memory/stale", projectScoped: true, request: s.staleMemoriesRequestSchema, response: s.staleMemoriesResponseSchema },
  exportStaticMemoryFiles: { method: "POST", path: "/v1/export", projectScoped: true, request: s.exportRequestSchema, response: s.exportResponseSchema },
  getDiagnostics: { method: "GET", path: "/v1/diagnostics", projectScoped: true, request: s.diagnosticsRequestSchema, response: s.diagnosticsResponseSchema },
  listAuditLog: { method: "GET", path: "/v1/audit", projectScoped: true, request: s.auditRequestSchema, response: s.auditResponseSchema },
  health: { method: "GET", path: "/v1/health", projectScoped: false, request: s.healthRequestSchema, response: s.healthResponseSchema },
  configureGitHubTeamMode: { method: "POST", path: "/v1/collaboration/github-team", projectScoped: true, request: s.configureGitHubTeamRequestSchema, response: s.configureGitHubTeamResponseSchema },
  getCollaborationStatus: { method: "GET", path: "/v1/collaboration/status", projectScoped: true, request: s.collaborationStatusRequestSchema, response: s.collaborationStatusResponseSchema },
} as const;

export type EndpointName = keyof typeof endpoints;
export type EndpointRequest<K extends EndpointName> = z.input<(typeof endpoints)[K]["request"]>;
export type EndpointResponse<K extends EndpointName> = z.output<(typeof endpoints)[K]["response"]>;
