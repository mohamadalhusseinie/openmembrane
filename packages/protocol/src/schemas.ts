import { isAbsolute } from "node:path";
import { z } from "zod";
import {
  collaborationModes, collaborationReviewProviders, confidenceValues, conflictKinds,
  diagnosticSeverities, MAX_SUMMARY_LENGTH, MAX_TRANSCRIPT_LENGTH, memoryScopes,
  memoryStatuses, memoryTypes, proposalStates, recommendedActions, retryStatuses, sensitivityValues,
} from "@openmembrane/core";
import type { AuditEvent, MemorySource } from "@openmembrane/core";

const text = z.string().min(1);
const count = z.number().int().nonnegative();
const limit = (max: number) => z.number().int().positive().max(max).optional();
export const absolutePathSchema = text.refine(isAbsolute, "An absolute path is required.");
export const projectRequestSchema = z.object({
  projectRoot: absolutePathSchema,
  projectId: text.refine((value) => value.trim().length > 0).optional(),
  storageDir: absolutePathSchema.optional(),
  storageBackend: z.enum(["json", "sqlite"]).optional(),
});
export const errorResponseSchema = z.object({
  error: z.object({ code: text, safeMessage: text, diagnosticId: text }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const memorySourceSchema = z.object({
  kind: z.enum(["session", "manual", "import", "system"] satisfies [MemorySource["kind"], ...MemorySource["kind"][]]),
  sessionId: text.optional(),
  tool: text.optional(),
  excerpt: z.string().optional(),
  transcriptHash: text.optional(),
});
const memoryShape = {
  id: text, projectId: text, type: z.enum(memoryTypes), content: text,
  scope: z.enum(memoryScopes), confidence: z.enum(confidenceValues),
  reason: z.string(), tags: z.array(text), createdAt: text, updatedAt: text,
};
export const memoryCandidateSchema = z.object({
  ...memoryShape, source: memorySourceSchema, sensitivity: z.enum(sensitivityValues),
  recommendedAction: z.enum(recommendedActions),
  rejectionReason: z.string().optional(), duplicateOf: text.optional(), conflictWith: z.array(text).optional(),
});
export const sharedMemoryEntrySchema = z.object({
  ...memoryShape, sensitivity: z.enum(["public", "internal", "confidential"]),
  status: z.enum(memoryStatuses), approvedAt: text.optional(),
  supersededBy: text.optional(), supersededAt: text.optional(),
});
export const memoryEntrySchema = sharedMemoryEntrySchema.extend({ source: memorySourceSchema });
export const contextMemorySchema = memoryEntrySchema.extend({
  conflicts: z.array(z.object({ memoryId: text, kind: z.enum(conflictKinds) })).optional(),
});
export const repositoryInputSchema = z.object({ host: text, owner: text, name: text });
export const repositorySchema = repositoryInputSchema.extend({ defaultBranch: text });
export const collaborationConfigSchema = z.object({
  projectId: text, mode: z.enum(collaborationModes), repository: repositorySchema,
  checkoutPath: text, repositoryInitialized: z.boolean().optional(), createdAt: text, updatedAt: text,
});
export const collaborationProposalSchema = z.object({
  projectId: text, memory: sharedMemoryEntrySchema, operation: z.enum(["upsert", "remove"]).optional(),
  removalMemoryIds: z.array(text).optional(), state: z.enum(proposalStates),
  review: z.object({
    provider: z.enum(collaborationReviewProviders), id: text, url: text, branch: text,
    mergedAt: text.optional(), mergedCommit: text.optional(), closedAt: text.optional(), closedBy: text.optional(),
  }).optional(),
  retry: z.object({
    status: z.enum(retryStatuses), attempts: count, lastAttemptAt: text.optional(),
    nextAttemptAt: text.optional(), failureCode: text.optional(),
  }),
  createdAt: text, updatedAt: text,
});
const publicationShapes = [
  { kind: z.literal("published"), proposal: collaborationProposalSchema },
  { kind: z.literal("retry_scheduled"), code: z.literal("GITHUB_PUBLICATION_FAILED"), nextAttemptAt: text },
  { kind: z.literal("retry_deferred"), nextAttemptAt: text },
  { kind: z.literal("rejected"), code: z.enum(["GITHUB_TEAM_NOT_CONFIGURED", "GITHUB_MEMORY_INVALID"]), message: text },
] as const;
export const memoryMutationResponseSchema = z.union([
  memoryEntrySchema.extend(publicationShapes[0]).strict(),
  memoryEntrySchema.extend(publicationShapes[1]).strict(),
  memoryEntrySchema.extend(publicationShapes[2]).strict(),
  memoryEntrySchema.extend(publicationShapes[3]).strict(),
  memoryEntrySchema.strict(),
]);
export const ingestionResponseSchema = z.object({
  projectId: text, savedCount: count, pendingCount: count, rejectedCount: count,
  supersededCount: count, redactionCount: count,
  saved: z.array(z.object({
    id: text, type: z.enum(memoryTypes), scope: z.enum(memoryScopes), content: text, replaces: z.array(text).optional(),
  })),
  pending: z.array(z.object({
    id: text, type: z.enum(memoryTypes), scope: z.enum(memoryScopes), content: text,
    recommendedAction: z.enum(recommendedActions), conflictWith: z.array(text).optional(),
  })),
  rejected: z.array(z.object({
    id: text, type: z.enum(memoryTypes), rejectionReason: z.string().optional(), duplicateOf: text.optional(),
  })),
  superseded: z.array(z.object({ id: text, supersededBy: text.optional() })),
  proposalCount: count.optional(),
  proposals: z.array(z.object({ memoryId: text, state: text, nextAttemptAt: text.optional() })).optional(),
});
export const rememberItemSchema = z.object({
  content: z.string().min(10).max(2000), type: z.enum(memoryTypes),
  scope: z.enum(memoryScopes).optional(), confidence: z.enum(confidenceValues).optional(), tags: z.array(text).optional(),
});
export const rememberRequestSchema = projectRequestSchema.extend({
  ...rememberItemSchema.partial().shape, items: z.array(rememberItemSchema).optional(),
}).refine((input) => (input.items?.length ?? 0) > 0 || (input.content !== undefined && input.type !== undefined),
  "Provide content and type, or non-empty items.");
export const ingestRequestSchema = projectRequestSchema.extend({
  transcript: text.max(MAX_TRANSCRIPT_LENGTH).optional(), summary: text.max(MAX_SUMMARY_LENGTH).optional(),
  tool: text.optional(), sessionId: text.optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}).refine((input) => input.transcript !== undefined || input.summary !== undefined, "Provide transcript or summary.");
export const rememberResponseSchema = ingestionResponseSchema;
export const ingestResponseSchema = ingestionResponseSchema;
export const rulesRequestSchema = projectRequestSchema.extend({ scope: z.enum(memoryScopes).optional(), limit: limit(200) });
export const rulesResponseSchema = z.object({ rules: z.array(memoryEntrySchema), pendingCandidateCount: count });
export const contextRequestSchema = projectRequestSchema.extend({
  query: text, scope: z.enum(memoryScopes).optional(), limit: limit(50),
});
export const contextResponseSchema = z.object({ memories: z.array(contextMemorySchema), pendingCandidateCount: count });
export const searchRequestSchema = projectRequestSchema.extend({
  query: z.string().optional(), scopes: z.array(z.enum(memoryScopes)).optional(),
  types: z.array(z.enum(memoryTypes)).optional(), tags: z.array(text).optional(), limit: limit(200),
});
export const searchResponseSchema = z.array(memoryEntrySchema);
export const candidatesRequestSchema = projectRequestSchema.extend({ limit: limit(200) });
export const candidatesResponseSchema = z.array(memoryCandidateSchema);
export const approveCandidateRequestSchema = projectRequestSchema.extend({ candidateId: text });
export const approveCandidateResponseSchema = memoryMutationResponseSchema;
export const rejectCandidateRequestSchema = approveCandidateRequestSchema.extend({ reason: text.optional() });
export const rejectCandidateResponseSchema = z.object({ projectId: text, candidateId: text, rejected: z.literal(true) });
export const approveAllRequestSchema = projectRequestSchema;
export const approveAllResponseSchema = z.object({
  projectId: text, approved: z.array(memoryMutationResponseSchema),
  skipped: z.array(z.object({ candidateId: text, reason: z.string() })),
});
export const rejectAllRequestSchema = projectRequestSchema.extend({ reason: text.optional() });
export const rejectAllResponseSchema = z.object({ projectId: text, rejectedCount: count });
export const updateMemoryRequestSchema = projectRequestSchema.extend({
  memoryId: text, content: text.optional(), type: z.enum(memoryTypes).optional(),
  scope: z.enum(memoryScopes).optional(), tags: z.array(text).optional(),
});
export const updateMemoryResponseSchema = memoryMutationResponseSchema;
export const supersedeMemoryRequestSchema = projectRequestSchema.extend({
  memoryId: text, reason: text.optional(), replacementId: text.optional(),
});
export const supersedeMemoryResponseSchema = memoryMutationResponseSchema;
export const staleMemoriesRequestSchema = projectRequestSchema.extend({ staleAfterMonths: limit(120) });
export const staleMemoriesResponseSchema = z.array(memoryEntrySchema);
export const exportTargets = ["agents", "claude", "copilot", "cursor", "project_memory"] as const;
export const exportRequestSchema = projectRequestSchema.extend({
  targets: z.array(z.enum(exportTargets)).optional(), outputDir: text.optional(), includeConfidential: z.boolean().optional(),
});
export const exportResponseSchema = z.object({
  projectId: text,
  files: z.array(z.object({ target: z.enum(exportTargets), path: text, content: z.string(), memoryCount: count })),
});
export const diagnosticEventSchema = z.object({
  id: text, projectId: text, severity: z.enum(diagnosticSeverities), code: text, message: z.string(),
  operation: text.optional(), source: z.enum(["core", "storage", "mcp-server", "exporter", "adapter"]).optional(),
  entityId: text.optional(), createdAt: text, details: z.record(z.string(), z.unknown()).optional(),
});
export const diagnosticsRequestSchema = projectRequestSchema.extend({
  severity: z.enum(diagnosticSeverities).optional(), code: text.optional(), limit: limit(500),
});
export const diagnosticsResponseSchema = z.array(diagnosticEventSchema);
export const auditEventSchema = z.object({
  id: text, projectId: text,
  type: z.enum([
    "session_ingested", "candidate_extracted", "memory_saved", "candidate_queued", "candidate_rejected",
    "memory_superseded", "memory_proposed", "memory_updated",
  ] satisfies [AuditEvent["type"], ...AuditEvent["type"][]]),
  entityId: text.optional(), createdAt: text, details: z.record(z.string(), z.unknown()).optional(),
});
export const auditRequestSchema = projectRequestSchema.extend({ limit: limit(500) });
export const auditResponseSchema = z.array(auditEventSchema);
export const healthRequestSchema = z.object({});
export const healthResponseSchema = z.object({}).strict();
export const configureGitHubTeamRequestSchema = projectRequestSchema.extend({ repository: repositoryInputSchema });
export const configureGitHubTeamResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("configured"), config: collaborationConfigSchema }),
  z.object({
    kind: z.literal("rejected"),
    code: z.enum([
      "GITHUB_CONFIGURATION_INVALID", "GITHUB_CLI_UNAVAILABLE", "GITHUB_AUTH_REQUIRED",
      "GITHUB_REPOSITORY_UNAVAILABLE", "GITHUB_REPOSITORY_NOT_PRIVATE",
      "GITHUB_REPOSITORY_NOT_INITIALIZED", "GITHUB_CHECKOUT_FAILED",
    ]),
    message: text,
  }),
]);
export const collaborationStatusRequestSchema = projectRequestSchema;
export const collaborationStatusResponseSchema = z.object({
  mode: z.enum(collaborationModes), repository: repositorySchema.optional(),
  proposals: z.object({ proposed: count, active: count, rejected: count, syncFailed: count, conflict: count }),
  retries: z.array(z.object({ memoryId: text, attempts: count, nextAttemptAt: text })),
});
