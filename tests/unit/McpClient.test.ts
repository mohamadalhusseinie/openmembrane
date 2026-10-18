import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OpenMembraneClient, OpenMembraneClientError } from "@openmembrane/client";
import { createOpenMembraneContext } from "../../apps/mcp-server/src/context";
import type { OpenMembraneMcpContext } from "../../apps/mcp-server/src/context";
import { createOpenMembraneMcpServer, safeJsonResult } from "../../apps/mcp-server/src/server";
import { protocolFixtures } from "./protocolFixtures";

const cases = [
  { tool: "remember", method: "remember", input: { projectId: "other", items: [{ content: "Use isolated test fixtures.", type: "testing_rule", confidence: "high" }] } },
  { tool: "get_project_rules", method: "getProjectRules", input: { projectId: "other", scope: "frontend", limit: 3 } },
  { tool: "get_relevant_context", method: "getRelevantContext", input: { projectId: "other", query: "Angular", scope: "frontend", limit: 3 } },
  { tool: "search_memory", method: "searchMemory", input: { projectId: "other", query: "Angular", types: ["coding_rule"], scopes: ["frontend"], tags: ["angular"], limit: 3 } },
  { tool: "list_memory_candidates", method: "listMemoryCandidates", input: { projectId: "other", limit: 3 } },
  { tool: "approve_memory_candidate", method: "approveMemoryCandidate", input: { projectId: "other", candidateId: "candidate with spaces" } },
  { tool: "reject_memory_candidate", method: "rejectMemoryCandidate", input: { projectId: "other", candidateId: "candidate with spaces", reason: "Obsolete" } },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mockClient() {
  return {
    remember: vi.fn<OpenMembraneMcpContext["client"]["remember"]>().mockResolvedValue(protocolFixtures.remember.response),
    getProjectRules: vi.fn<OpenMembraneMcpContext["client"]["getProjectRules"]>().mockResolvedValue(protocolFixtures.getProjectRules.response),
    getRelevantContext: vi.fn<OpenMembraneMcpContext["client"]["getRelevantContext"]>().mockResolvedValue(protocolFixtures.getRelevantContext.response),
    searchMemory: vi.fn<OpenMembraneMcpContext["client"]["searchMemory"]>().mockResolvedValue(protocolFixtures.searchMemory.response),
    listMemoryCandidates: vi.fn<OpenMembraneMcpContext["client"]["listMemoryCandidates"]>().mockResolvedValue(protocolFixtures.listMemoryCandidates.response),
    approveMemoryCandidate: vi.fn<OpenMembraneMcpContext["client"]["approveMemoryCandidate"]>().mockResolvedValue(protocolFixtures.approveMemoryCandidate.response),
    rejectMemoryCandidate: vi.fn<OpenMembraneMcpContext["client"]["rejectMemoryCandidate"]>().mockResolvedValue(protocolFixtures.rejectMemoryCandidate.response),
  };
}

describe("thin MCP daemon adapter", () => {
  it.each(cases)("maps $tool to $method without changing input or output", async ({ tool, method, input }) => {
    vi.stubEnv("OPENMEMBRANE_NUDGE_ENABLED", "false");
    const daemon = mockClient();
    const server = createOpenMembraneMcpServer({ client: daemon });
    const client = new Client({ name: "mcp-unit-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect((await client.listTools()).tools.map((item) => item.name).sort()).toEqual(cases.map((item) => item.tool).sort());
      for (const method of Object.values(daemon)) expect(method).not.toHaveBeenCalled();
      const result = await client.callTool({ name: tool, arguments: input });
      expect(daemon[method]).toHaveBeenCalledExactlyOnceWith(input);
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(protocolFixtures[method].response, null, 2) }]);
      for (const [name, handler] of Object.entries(daemon)) {
        if (name !== method) expect(handler).not.toHaveBeenCalled();
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("creates a lazy client without contacting or starting the daemon", () => {
    const call = vi.spyOn(OpenMembraneClient.prototype, "call");
    const launch = vi.fn();
    const context = createOpenMembraneContext({ autoLaunch: launch });
    expect(context.client).toBeInstanceOf(OpenMembraneClient);
    expect(call).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("preserves daemon error codes, safe messages and diagnostic IDs", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = await safeJsonResult("approve_memory_candidate", async () => {
      throw new OpenMembraneClientError("CANDIDATE_NOT_FOUND", "The candidate was not found.", {
        diagnosticId: "diag_daemon", origin: "daemon", cause: new Error("private daemon details"),
      });
    });
    expect(result).toMatchObject({ isError: true, content: [{
      type: "text", text: JSON.stringify({ error: {
        code: "CANDIDATE_NOT_FOUND", message: "The candidate was not found.", diagnosticId: "diag_daemon",
      } }, null, 2),
    }] });
    expect(stderr).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private daemon details");
  });

  it("returns a safe validation envelope without launching for invalid remember input", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const launch = vi.fn();
    const { client } = createOpenMembraneContext({ autoLaunch: launch });
    const result = await safeJsonResult("remember", () => client.remember({ items: [] }));
    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("Expected text error envelope.");
    expect(JSON.parse(block.text)).toMatchObject({ error: {
      code: "VALIDATION_ERROR", message: "The tool input does not match the daemon protocol.", diagnosticId: expect.stringMatching(/^diag_/),
    } });
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([
    new OpenMembraneClientError("E_DAEMON_LAUNCH_FAILED", "The daemon could not be launched.", { cause: new Error("private path") }),
    new Error("private path"),
  ])("reports local failures safely on stderr with a correlated diagnostic ID", async (error) => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = await safeJsonResult("remember", () => Promise.reject(error));
    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("Expected text error envelope.");
    const payload = JSON.parse(block.text);
    expect(payload.error.diagnosticId).toMatch(/^diag_/);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(payload.error.diagnosticId));
    expect(JSON.stringify(result)).not.toContain("private path");
    expect(stderr.mock.calls.flat().join("")).not.toContain("private path");
  });
});
