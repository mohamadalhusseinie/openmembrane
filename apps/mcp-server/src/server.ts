import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createId } from "@openmembrane/shared";
import { OpenMembraneClientError } from "@openmembrane/client";
import { normalizeOpenMembraneError } from "@openmembrane/core";
import { ZodError } from "zod";
import type { OpenMembraneMcpContext } from "./context";
import { createToolHandlers } from "./tools/handlers";
import { SessionNudgeTracker, loadNudgeConfig } from "./nudge";
import {
  approveMemoryCandidateSchema,
  getProjectRulesSchema,
  getRelevantContextSchema,
  rememberSchema,
  listMemoryCandidatesSchema,
  rejectMemoryCandidateSchema,
  searchMemorySchema
} from "./tools/schemas";

export function createOpenMembraneMcpServer(context: OpenMembraneMcpContext): McpServer {
  const server = new McpServer({
    name: "openmembrane",
    version: "0.1.0"
  });
  const handlers = createToolHandlers(context);
  const tracker = new SessionNudgeTracker(loadNudgeConfig());

  server.registerTool(
    "remember",
    {
      title: "Remember",
      description:
        "Save structured memories directly. The AI extracts and classifies knowledge itself, then passes it here for safety checks and persistence. Accepts a single {content, type} or batch {items: [...]}. This is the primary tool for saving project knowledge — no server-side LLM needed.",
      inputSchema: rememberSchema
    },
    async (input) => safeJsonResult("remember", () => handlers.remember(input), tracker)
  );

  server.registerTool(
    "get_project_rules",
    {
      title: "Get Project Rules",
      description: "Return saved rules, decisions, gotchas, and constraints for a project.",
      inputSchema: getProjectRulesSchema
    },
    async (input) => safeJsonResult("get_project_rules", () => handlers.getProjectRules(input), tracker)
  );

  server.registerTool(
    "get_relevant_context",
    {
      title: "Get Relevant Context",
      description: "Return saved memory relevant to a query for future AI coding sessions.",
      inputSchema: getRelevantContextSchema
    },
    async (input) => safeJsonResult("get_relevant_context", () => handlers.getRelevantContext(input), tracker)
  );

  server.registerTool(
    "search_memory",
    {
      title: "Search Memory",
      description: "Search saved OpenMembrane memory by query, scope, type, tag, or project.",
      inputSchema: searchMemorySchema
    },
    async (input) => safeJsonResult("search_memory", () => handlers.searchMemory(input), tracker)
  );

  server.registerTool(
    "list_memory_candidates",
    {
      title: "List Memory Candidates",
      description: "List pending memory candidates waiting for developer approval.",
      inputSchema: listMemoryCandidatesSchema
    },
    async (input) => safeJsonResult("list_memory_candidates", () => handlers.listMemoryCandidates(input), tracker)
  );

  server.registerTool(
    "approve_memory_candidate",
    {
      title: "Approve Memory Candidate",
      description: "Approve a pending candidate and persist it as local project memory.",
      inputSchema: approveMemoryCandidateSchema
    },
    async (input) =>
      safeJsonResult("approve_memory_candidate", () => handlers.approveMemoryCandidate(input), tracker)
  );

  server.registerTool(
    "reject_memory_candidate",
    {
      title: "Reject Memory Candidate",
      description: "Reject and remove a pending memory candidate.",
      inputSchema: rejectMemoryCandidateSchema
    },
    async (input) => safeJsonResult("reject_memory_candidate", () => handlers.rejectMemoryCandidate(input), tracker)
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
  operation: string,
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
    const normalized = normalizeOpenMembraneError(error);
    const clientError = error instanceof OpenMembraneClientError ? error : undefined;
    const diagnosticId = clientError?.diagnosticId ?? createId("diag");
    const payload = clientError
      ? { code: clientError.code, message: clientError.safeMessage }
      : error instanceof ZodError
        ? { code: "VALIDATION_ERROR", message: "The tool input does not match the daemon protocol." }
        : normalized.toSafePayload();
    if (!clientError?.diagnosticId) {
      process.stderr.write(`OpenMembrane MCP ${operation} failed [${payload.code}] (diagnostic: ${diagnosticId}).\n`);
    }

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: {
                ...payload,
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

function hasSavedMemories(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;

  if ("savedCount" in value) {
    const count = value.savedCount;
    return typeof count === "number" && count > 0;
  }

  if ("saved" in value) {
    const saved = value.saved;
    return Array.isArray(saved) && saved.length > 0;
  }

  return false;
}
