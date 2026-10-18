import { z } from "zod";
import { confidenceValues, memoryScopes, memoryTypes } from "@openmembrane/core";

export const projectIdSchema = {
  projectId: z.string().min(1).optional().describe("Project identifier. Defaults to OPENMEMBRANE_PROJECT_ID or the current folder name.")
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
