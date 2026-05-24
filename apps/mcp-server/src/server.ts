import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createId, nowIso } from "@openmembrain/shared";
import { normalizeOpenMembrainError } from "@openmembrain/core";
import { resolveProjectId, type OpenMembrainMcpContext } from "./context";
import { createToolHandlers } from "./tools/handlers";
import { SessionNudgeTracker, loadNudgeConfig } from "./nudge";
import {
  approveAllCandidatesSchema,
  approveMemoryCandidateSchema,
  exportStaticMemoryFilesSchema,
  getDiagnosticsSchema,
  getProjectRulesSchema,
  getRelevantContextSchema,
  listAuditLogSchema,
  rejectAllCandidatesSchema,
  rememberSchema,
  supersedeMemorySchema,
  updateMemorySchema,
  listMemoryCandidatesSchema,
  proposeMemoryFromSessionSchema,
  rejectMemoryCandidateSchema,
  reviewStaleMemoriesSchema,
  searchMemorySchema
} from "./tools/schemas";

export function createOpenMembrainMcpServer(context: OpenMembrainMcpContext): McpServer {
  const server = new McpServer({
    name: "openmembrain",
    version: "0.1.0"
  });
  const handlers = createToolHandlers(context);
  const tracker = new SessionNudgeTracker(loadNudgeConfig());

  server.registerTool(
    "propose_memory_from_session",
    {
      title: "Propose Memory From Session",
      description:
        "Analyze a session transcript or summary, reject unsafe/noisy content, auto-save low-risk memory, and queue important candidates.",
      inputSchema: proposeMemoryFromSessionSchema
    },
    async (input) =>
      safeJsonResult(context, "propose_memory_from_session", input, () => handlers.proposeMemoryFromSession(input), tracker)
  );

  server.registerTool(
    "remember",
    {
      title: "Remember",
      description:
        "Save structured memories directly. The AI extracts and classifies knowledge itself, then passes it here for safety checks and persistence. Accepts a single {content, type} or batch {items: [...]}. This is the primary tool for saving project knowledge — no server-side LLM needed.",
      inputSchema: rememberSchema
    },
    async (input) => safeJsonResult(context, "remember", input, () => handlers.remember(input), tracker)
  );

  server.registerTool(
    "get_project_rules",
    {
      title: "Get Project Rules",
      description: "Return saved rules, decisions, gotchas, and constraints for a project.",
      inputSchema: getProjectRulesSchema
    },
    async (input) => safeJsonResult(context, "get_project_rules", input, () => handlers.getProjectRules(input), tracker)
  );

  server.registerTool(
    "get_relevant_context",
    {
      title: "Get Relevant Context",
      description: "Return saved memory relevant to a query for future AI coding sessions.",
      inputSchema: getRelevantContextSchema
    },
    async (input) => safeJsonResult(context, "get_relevant_context", input, () => handlers.getRelevantContext(input), tracker)
  );

  server.registerTool(
    "search_memory",
    {
      title: "Search Memory",
      description: "Search saved OpenMembrain memory by query, scope, type, tag, or project.",
      inputSchema: searchMemorySchema
    },
    async (input) => safeJsonResult(context, "search_memory", input, () => handlers.searchMemory(input), tracker)
  );

  server.registerTool(
    "list_memory_candidates",
    {
      title: "List Memory Candidates",
      description: "List pending memory candidates waiting for developer approval.",
      inputSchema: listMemoryCandidatesSchema
    },
    async (input) => safeJsonResult(context, "list_memory_candidates", input, () => handlers.listMemoryCandidates(input), tracker)
  );

  server.registerTool(
    "approve_memory_candidate",
    {
      title: "Approve Memory Candidate",
      description: "Approve a pending candidate and persist it as local project memory.",
      inputSchema: approveMemoryCandidateSchema
    },
    async (input) =>
      safeJsonResult(context, "approve_memory_candidate", input, () => handlers.approveMemoryCandidate(input), tracker)
  );

  server.registerTool(
    "reject_memory_candidate",
    {
      title: "Reject Memory Candidate",
      description: "Reject and remove a pending memory candidate.",
      inputSchema: rejectMemoryCandidateSchema
    },
    async (input) => safeJsonResult(context, "reject_memory_candidate", input, () => handlers.rejectMemoryCandidate(input), tracker)
  );

  server.registerTool(
    "approve_all_candidates",
    {
      title: "Approve All Candidates",
      description: "Approve all pending memory candidates at once. Secret candidates are skipped.",
      inputSchema: approveAllCandidatesSchema
    },
    async (input) =>
      safeJsonResult(context, "approve_all_candidates", input, () => handlers.approveAllCandidates(input), tracker)
  );

  server.registerTool(
    "reject_all_candidates",
    {
      title: "Reject All Candidates",
      description: "Reject and remove all pending memory candidates at once.",
      inputSchema: rejectAllCandidatesSchema
    },
    async (input) =>
      safeJsonResult(context, "reject_all_candidates", input, () => handlers.rejectAllCandidates(input), tracker)
  );

  server.registerTool(
    "export_static_memory_files",
    {
      title: "Export Static Memory Files",
      description:
        "Generate fallback instruction files such as AGENTS.md, CLAUDE.md, Copilot instructions, Cursor rules, and docs/ai/project-memory.md.",
      inputSchema: exportStaticMemoryFilesSchema
    },
    async (input) =>
      safeJsonResult(context, "export_static_memory_files", input, () => handlers.exportStaticMemoryFiles(input), tracker)
  );

  server.registerTool(
    "review_stale_memories",
    {
      title: "Review Stale Memories",
      description:
        "List active memories that have not been updated recently. Useful for reviewing potentially outdated project knowledge.",
      inputSchema: reviewStaleMemoriesSchema
    },
    async (input) =>
      safeJsonResult(context, "review_stale_memories", input, () => handlers.reviewStaleMemories(input), tracker)
  );

  server.registerTool(
    "get_diagnostics",
    {
      title: "Get Diagnostics",
      description: "Return recent OpenMembrain diagnostics for user-visible troubleshooting.",
      inputSchema: getDiagnosticsSchema
    },
    async (input) => safeJsonResult(context, "get_diagnostics", input, () => handlers.getDiagnostics(input), tracker)
  );

  server.registerTool(
    "supersede_memory",
    {
      title: "Supersede Memory",
      description:
        "Mark an existing memory as superseded. Superseded memories are excluded from retrieval but preserved in audit history.",
      inputSchema: supersedeMemorySchema
    },
    async (input) => safeJsonResult(context, "supersede_memory", input, () => handlers.supersedeMemory(input), tracker)
  );

  server.registerTool(
    "update_memory",
    {
      title: "Update Memory",
      description:
        "Update the content, type, scope, or tags of a saved memory. The updated content is re-validated through policy checks.",
      inputSchema: updateMemorySchema
    },
    async (input) => safeJsonResult(context, "update_memory", input, () => handlers.updateMemory(input), tracker)
  );

  server.registerTool(
    "list_audit_log",
    {
      title: "List Audit Log",
      description: "Return recent OpenMembrain audit events for memory pipeline activity.",
      inputSchema: listAuditLogSchema
    },
    async (input) => safeJsonResult(context, "list_audit_log", input, () => handlers.listAuditLog(input), tracker)
  );

  return server;
}

function jsonResult(value: unknown, reminder?: string): CallToolResult {
  if (reminder && typeof value === "object" && value !== null && !Array.isArray(value)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ...value, sessionReminder: reminder }, null, 2)
        }
      ]
    };
  }

  const result: CallToolResult = {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };

  if (reminder) {
    result.content.push({ type: "text", text: reminder });
  }

  return result;
}

export async function safeJsonResult(
  context: OpenMembrainMcpContext,
  operation: string,
  input: unknown,
  callback: () => Promise<unknown>,
  tracker?: SessionNudgeTracker
): Promise<CallToolResult> {
  const reminder = tracker?.recordToolCall(operation);

  try {
    const value = await callback();

    if (tracker?.isSaveOperation(operation) && hasSavedMemories(value)) {
      tracker.recordMemorySaved();
    }

    return jsonResult(value, reminder);
  } catch (error) {
    const normalized = normalizeOpenMembrainError(error);
    const diagnosticId = createId("diag");
    const projectId = projectIdFromInput(context, input);

    try {
      const diagnosticEvent = {
        id: diagnosticId,
        projectId,
        severity: "error",
        code: normalized.code,
        message: normalized.safeMessage,
        operation,
        source: "mcp-server",
        createdAt: nowIso()
      } as const;

      await context.diagnosticsLogStore.append(
        normalized.details ? { ...diagnosticEvent, details: normalized.details } : diagnosticEvent
      );
    } catch {
      // Do not mask the original tool error if diagnostics persistence fails.
    }

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: {
                ...normalized.toSafePayload(),
                diagnosticId
              }
            },
            null,
            2
          )
        }
      ]
    };
  }
}

function projectIdFromInput(context: OpenMembrainMcpContext, input: unknown): string {
  if (typeof input === "object" && input !== null && "projectId" in input) {
    const projectId = input.projectId;
    if (typeof projectId === "string") {
      return resolveProjectId(context, projectId);
    }
  }

  return context.defaultProjectId;
}

/**
 * Check if the handler result indicates at least one memory was actually persisted.
 * Both `remember` and `proposeMemoryFromSession` return objects with `savedCount` or `saved` array.
 */
function hasSavedMemories(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;

  if ("savedCount" in value) {
    const count = (value as { savedCount: unknown }).savedCount;
    return typeof count === "number" && count > 0;
  }

  if ("saved" in value) {
    const saved = (value as { saved: unknown }).saved;
    return Array.isArray(saved) && saved.length > 0;
  }

  return false;
}
