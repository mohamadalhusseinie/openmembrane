import { describe, expect, it } from "vitest";
import { parseArgs, type CliCommand, type ParseResult } from "../../../apps/mcp-server/src/cli/parseArgs";

function argv(...args: string[]): readonly string[] {
  return ["node", "openmembrain", ...args];
}

function expectOk(result: ParseResult): CliCommand {
  expect(result.ok).toBe(true);
  return (result as { ok: true; value: CliCommand }).value;
}

function expectError(result: ParseResult): string {
  expect(result.ok).toBe(false);
  return (result as { ok: false; error: string }).error;
}

describe("parseArgs", () => {
  describe("default / serve", () => {
    it("returns serve when no args", () => {
      const cmd = expectOk(parseArgs(argv()));
      expect(cmd.command).toBe("serve");
    });

    it("returns serve for explicit 'serve' subcommand", () => {
      const cmd = expectOk(parseArgs(argv("serve")));
      expect(cmd.command).toBe("serve");
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
  });
});
