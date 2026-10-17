import { describe, expect, it } from "vitest";
import { parseArgs, type CliCommand, type ParseResult } from "../../../apps/mcp-server/src/cli/parseArgs";

function argv(...args: string[]): readonly string[] {
  return ["node", "openmembrane", ...args];
}

function expectOk(result: ParseResult): CliCommand {
  expect(result.ok).toBe(true);
  return (result as { ok: true; value: CliCommand }).value;
}

function expectError(result: ParseResult): string {
  expect(result.ok).toBe(false);
  return (result as { ok: false; error: string }).error;
}

describe("ingest timeout options", () => {
  it("accepts an explicit ingestion deadline", () => {
    expect(expectOk(parseArgs(argv("ingest", "--stdin", "--timeout-ms", "3600000")))).toMatchObject({
      command: "ingest", timeoutMs: 3_600_000,
    });
  });

  it.each(["0", "-1", "1.5", "NaN", "Infinity", "2147483648"])("rejects invalid timeout %s", (value) => {
    expect(expectError(parseArgs(argv("ingest", "--stdin", "--timeout-ms", value)))).toContain("--timeout-ms");
  });

  it("rejects a missing timeout value", () => {
    expect(expectError(parseArgs(argv("ingest", "--stdin", "--timeout-ms")))).toContain("--timeout-ms");
  });
});

describe("parseArgs", () => {
  describe("MCP and daemon lifecycle", () => {
    it("returns mcp when no args", () => {
      const cmd = expectOk(parseArgs(argv()));
      expect(cmd.command).toBe("mcp");
    });

    it("returns serve for explicit 'serve' subcommand", () => {
      const cmd = expectOk(parseArgs(argv("serve")));
      expect(cmd.command).toBe("serve");
    });

    it.each(["mcp", "start", "stop", "status"])("recognizes %s", (command) => {
      expect(expectOk(parseArgs(argv(command))).command).toBe(command);
    });
  });

  describe("help", () => {
    it("returns help for --help", () => {
      const cmd = expectOk(parseArgs(argv("--help")));
      expect(cmd.command).toBe("help");
    });

    it("returns help for -h", () => {
      const cmd = expectOk(parseArgs(argv("-h")));
      expect(cmd.command).toBe("help");
    });

    it("returns help for 'help' subcommand", () => {
      const cmd = expectOk(parseArgs(argv("help")));
      expect(cmd.command).toBe("help");
    });
  });

  describe("ingest", () => {
    it("parses ingest with --file", () => {
      const cmd = expectOk(parseArgs(argv("ingest", "--file", "session.json")));
      expect(cmd).toEqual({
        command: "ingest",
        file: "session.json",
        stdin: false,
        tool: "unknown",
        project: undefined,
        format: "auto"
      });
    });

    it("parses ingest with --stdin", () => {
      const cmd = expectOk(parseArgs(argv("ingest", "--stdin")));
      expect(cmd).toEqual({
        command: "ingest",
        file: undefined,
        stdin: true,
        tool: "unknown",
        project: undefined,
        format: "auto"
      });
    });

    it("parses ingest with all options", () => {
      const cmd = expectOk(parseArgs(argv(
        "ingest", "--file", "s.txt", "--tool", "codex", "--project", "my-proj", "--format", "openai-chat"
      )));
      expect(cmd).toEqual({
        command: "ingest",
        file: "s.txt",
        stdin: false,
        tool: "codex",
        project: "my-proj",
        format: "openai-chat"
      });
    });

    it("errors when neither --file nor --stdin", () => {
      const err = expectError(parseArgs(argv("ingest")));
      expect(err).toContain("--file");
      expect(err).toContain("--stdin");
    });

    it("errors when both --file and --stdin", () => {
      const err = expectError(parseArgs(argv("ingest", "--file", "f.txt", "--stdin")));
      expect(err).toContain("cannot use both");
    });

    it("errors on invalid format", () => {
      const err = expectError(parseArgs(argv("ingest", "--file", "f.txt", "--format", "xml")));
      expect(err).toContain("Invalid format");
    });

    it("treats flag-like value for --file as missing", () => {
      const err = expectError(parseArgs(argv("ingest", "--file", "--tool")));
      expect(err).toContain("--file");
      expect(err).toContain("--stdin");
    });
  });

  describe("context", () => {
    it("parses context with no options", () => {
      const cmd = expectOk(parseArgs(argv("context")));
      expect(cmd).toEqual({
        command: "context",
        project: undefined,
        query: undefined,
        type: undefined,
        scope: undefined,
        output: "text"
      });
    });

    it("parses context with all options", () => {
      const cmd = expectOk(parseArgs(argv(
        "context", "--project", "p1", "--query", "deployment", "--type", "coding_rule", "--scope", "backend", "--output", "json"
      )));
      expect(cmd).toEqual({
        command: "context",
        project: "p1",
        query: "deployment",
        type: "coding_rule",
        scope: "backend",
        output: "json"
      });
    });

    it("errors on invalid output format", () => {
      const err = expectError(parseArgs(argv("context", "--output", "yaml")));
      expect(err).toContain("Invalid output format");
    });
  });

  describe("unknown command", () => {
    it("errors on unknown subcommand", () => {
      const err = expectError(parseArgs(argv("unknown")));
      expect(err).toContain("Unknown command");
      expect(err).toContain("unknown");
    });

    describe("daemon management commands", () => {
      it.each([
        [["candidates", "list"], "listMemoryCandidates"],
        [["candidates", "approve", "candidate"], "approveMemoryCandidate"],
        [["candidates", "reject", "candidate", "--reason", "Obsolete"], "rejectMemoryCandidate"],
        [["candidates", "approve-all"], "approveAllCandidates"],
        [["candidates", "reject-all"], "rejectAllCandidates"],
        [["memory", "update", "memory", "--content", "Updated project instructions"], "updateMemory"],
        [["memory", "supersede", "memory"], "supersedeMemory"],
        [["memory", "stale"], "reviewStaleMemories"],
        [["export", "--preview"], "exportStaticMemoryFiles"],
        [["diagnostics"], "getDiagnostics"],
        [["audit"], "listAuditLog"],
        [["team", "configure", "--owner", "team", "--repo", "memory"], "configureGitHubTeamMode"],
        [["team", "status"], "getCollaborationStatus"],
      ])("maps %j to %s", (args, operation) => {
        const parsed = parseArgs(argv(...args));
        expect(parsed).toMatchObject({ ok: true, value: { command: "manage", operation, output: "text" } });
      });

      it("retains IDs, arrays, numeric values, booleans and project override", () => {
        expect(parseArgs(argv("memory", "update", "a memory", "--tags", "one, two", "--project", "custom", "--output", "json"))).toMatchObject({
          ok: true, value: { input: { memoryId: "a memory", tags: ["one", "two"], projectId: "custom" }, output: "json" },
        });
        expect(parseArgs(argv("memory", "stale", "--stale-after-months", "12"))).toMatchObject({
          ok: true, value: { input: { staleAfterMonths: 12 } },
        });
        expect(parseArgs(argv("export", "--targets", "agents,claude", "--preview", "--include-confidential"))).toMatchObject({
          ok: true, value: { input: { targets: ["agents", "claude"], preview: true, includeConfidential: true } },
        });
        expect(parseArgs(argv("memory", "update", "id", "--tags", ""))).toMatchObject({
          ok: true, value: { input: { memoryId: "id", tags: [] } },
        });
      });

      it.each([
        ["candidates", "approve"], ["candidates", "reject", "a", "b"], ["candidates", "approve-all", "unexpected"],
        ["candidates", "list", "--limit", "201"], ["memory", "update", "id"],
        ["memory", "update", "id", "--type", "invalid"], ["memory", "update", "id", "--scope", "invalid"],
        ["memory", "stale", "--stale-after-months", "0"], ["memory", "stale", "--stale-after-months", "1.5"],
        ["export", "--targets", "invalid"], ["export", "--output-dir"], ["audit", "--limit", "NaN"],
        ["diagnostics", "--severity", "invalid"], ["team", "configure", "--owner", "team"],
        ["team", "status", "--unknown"], ["team", "invalid"], ["audit", "--output", "yaml"],
      ])("rejects malformed management command %j", (...args) => {
        expect(parseArgs(argv(...args)).ok).toBe(false);
      });

      it.each([["context", "--type", "invalid"], ["context", "--scope", "invalid"], ["ingest", "--stdin", "--output", "yaml"]])(
        "rejects invalid context and ingest options %j", (...args) => {
          expect(parseArgs(argv(...args)).ok).toBe(false);
        },
      );
    });
  });
});
