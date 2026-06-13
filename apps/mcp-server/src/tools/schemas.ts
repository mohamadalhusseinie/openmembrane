import { z } from "zod";
import { confidenceValues, diagnosticSeverities, memoryScopes, memoryTypes } from "@openmembrane/core";
import type { ExportTarget } from "@openmembrane/exporters";

export const exportTargets: readonly [ExportTarget, ...ExportTarget[]] = [
  "agents",
  "claude",
  "copilot",
  "cursor",
  "project_memory"
];

export const projectIdSchema = {
  projectId: z.string().min(1).optional().describe("Project identifier. Defaults to OPENMEMBRANE_PROJECT_ID or the current folder name.")
};

export const proposeMemoryFromSessionSchema = {
  ...projectIdSchema,
  transcript: z.string().min(1).optional().describe("AI coding session transcript. Raw full conversation storage is not persisted by default."),
  summary: z.string().min(1).optional().describe("AI coding session summary."),
  tool: z.string().min(1).optional().describe("Source AI tool or adapter name."),
  sessionId: z.string().min(1).optional().describe("Optional source session id."),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
};

export const getProjectRulesSchema = {
  ...projectIdSchema,
  scope: z.enum(memoryScopes).optional(),
  limit: z.number().int().positive().max(200).optional()
};

export const getRelevantContextSchema = {
  ...projectIdSchema,
  query: z.string().min(1),
  scope: z.enum(memoryScopes).optional(),
  limit: z.number().int().positive().max(50).optional()
};

export const searchMemorySchema = {
  ...projectIdSchema,
  query: z.string().optional(),
  scopes: z.array(z.enum(memoryScopes)).optional(),
  types: z.array(z.enum(memoryTypes)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(200).optional()
};

export const listMemoryCandidatesSchema = {
  ...projectIdSchema,
  limit: z.number().int().positive().max(200).optional()
};

export const approveMemoryCandidateSchema = {
  ...projectIdSchema,
  candidateId: z.string().min(1)
};

export const rejectMemoryCandidateSchema = {
  ...projectIdSchema,
  candidateId: z.string().min(1),
  reason: z.string().min(1).optional()
};

export const approveAllCandidatesSchema = {
  ...projectIdSchema,
};

export const rejectAllCandidatesSchema = {
  ...projectIdSchema,
  reason: z.string().min(1).optional().describe("Reason for rejecting all candidates."),
};

export const exportStaticMemoryFilesSchema = {
  ...projectIdSchema,
  targets: z.array(z.enum(exportTargets)).optional(),
  outputDir: z.string().min(1).optional().describe("Directory to write generated files into. Defaults to the MCP server working directory."),
  includeConfidential: z.boolean().optional().describe("Include confidential memory in static files. Defaults to false.")
};

export const getDiagnosticsSchema = {
  ...projectIdSchema,
  severity: z.enum(diagnosticSeverities).optional(),
  code: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional()
};

export const listAuditLogSchema = {
  ...projectIdSchema,
  limit: z.number().int().positive().max(500).optional()
};

export const reviewStaleMemoriesSchema = {
  ...projectIdSchema,
  staleAfterMonths: z.number().int().positive().max(120).optional().describe("Memories older than this many months are considered stale. Defaults to 6.")
};

export const supersedeMemorySchema = {
  ...projectIdSchema,
  memoryId: z.string().min(1).describe("The ID of the memory to supersede."),
  reason: z.string().min(1).optional().describe("Reason for superseding this memory."),
  replacementId: z.string().min(1).optional().describe("ID of the replacement memory, if any.")
};

export const updateMemorySchema = {
  ...projectIdSchema,
  memoryId: z.string().min(1).describe("The ID of the memory to update."),
  content: z.string().min(1).optional().describe("Updated memory content."),
  type: z.enum(memoryTypes).optional().describe("Updated memory type."),
  scope: z.enum(memoryScopes).optional().describe("Updated memory scope."),
  tags: z.array(z.string().min(1)).optional().describe("Updated tags (replaces existing tags).")
};

const rememberItemSchema = z.object({
  content: z.string().min(10).max(2000).describe("The memory content to save."),
  type: z.enum(memoryTypes).describe("Memory type (coding_rule, known_gotcha, architecture_decision, etc.)"),
  scope: z.enum(memoryScopes).optional().describe("Memory scope. Defaults to unknown."),
  confidence: z.enum(confidenceValues).optional().describe("Confidence level. Defaults to medium."),
  tags: z.array(z.string().min(1)).optional().describe("Optional tags for categorization.")
});

export const rememberSchema = {
  ...projectIdSchema,
  content: z.string().min(10).max(2000).optional().describe("The memory content (for single save). Provide content+type OR items[]."),
  type: z.enum(memoryTypes).optional().describe("Memory type (for single save)."),
  scope: z.enum(memoryScopes).optional().describe("Memory scope. Defaults to unknown."),
  confidence: z.enum(confidenceValues).optional().describe("Confidence level. Defaults to medium."),
  tags: z.array(z.string().min(1)).optional().describe("Optional tags for categorization."),
  items: z.array(rememberItemSchema).optional().describe("Batch: array of memory items to save.")
};
