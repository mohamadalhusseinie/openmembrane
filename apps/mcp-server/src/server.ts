import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OpenMembrainMcpContext } from "./context";
import { createToolHandlers } from "./tools/handlers";
import {
  approveMemoryCandidateSchema,
  exportStaticMemoryFilesSchema,
  getProjectRulesSchema,
  getRelevantContextSchema,
  listMemoryCandidatesSchema,
  proposeMemoryFromSessionSchema,
  rejectMemoryCandidateSchema,
  searchMemorySchema
} from "./tools/schemas";

export function createOpenMembrainMcpServer(context: OpenMembrainMcpContext): McpServer {
  const server = new McpServer({
    name: "openmembrain",
    version: "0.1.0"
  });
  const handlers = createToolHandlers(context);

  server.registerTool(
    "propose_memory_from_session",
    {
      title: "Propose Memory From Session",
      description:
        "Analyze a session transcript or summary, reject unsafe/noisy content, auto-save low-risk memory, and queue important candidates.",
      inputSchema: proposeMemoryFromSessionSchema
    },
    async (input) => jsonResult(await handlers.proposeMemoryFromSession(input))
  );

  server.registerTool(
    "get_project_rules",
    {
      title: "Get Project Rules",
      description: "Return saved rules, decisions, gotchas, and constraints for a project.",
      inputSchema: getProjectRulesSchema
    },
    async (input) => jsonResult(await handlers.getProjectRules(input))
  );

  server.registerTool(
    "get_relevant_context",
    {
      title: "Get Relevant Context",
      description: "Return saved memory relevant to a query for future AI coding sessions.",
      inputSchema: getRelevantContextSchema
    },
    async (input) => jsonResult(await handlers.getRelevantContext(input))
  );

  server.registerTool(
    "search_memory",
    {
      title: "Search Memory",
      description: "Search saved OpenMembrain memory by query, scope, type, tag, or project.",
      inputSchema: searchMemorySchema
    },
    async (input) => jsonResult(await handlers.searchMemory(input))
  );

  server.registerTool(
    "list_memory_candidates",
    {
      title: "List Memory Candidates",
      description: "List pending memory candidates waiting for developer approval.",
      inputSchema: listMemoryCandidatesSchema
    },
    async (input) => jsonResult(await handlers.listMemoryCandidates(input))
  );

  server.registerTool(
    "approve_memory_candidate",
    {
      title: "Approve Memory Candidate",
      description: "Approve a pending candidate and persist it as local project memory.",
      inputSchema: approveMemoryCandidateSchema
    },
    async (input) => jsonResult(await handlers.approveMemoryCandidate(input))
  );

  server.registerTool(
    "reject_memory_candidate",
    {
      title: "Reject Memory Candidate",
      description: "Reject and remove a pending memory candidate.",
      inputSchema: rejectMemoryCandidateSchema
    },
    async (input) => jsonResult(await handlers.rejectMemoryCandidate(input))
  );

  server.registerTool(
    "export_static_memory_files",
    {
      title: "Export Static Memory Files",
      description:
        "Generate fallback instruction files such as AGENTS.md, CLAUDE.md, Copilot instructions, Cursor rules, and docs/ai/project-memory.md.",
      inputSchema: exportStaticMemoryFilesSchema
    },
    async (input) => jsonResult(await handlers.exportStaticMemoryFiles(input))
  );

  return server;
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
