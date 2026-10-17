export type InputFormat = "auto" | "text" | "openai-chat";
export type OutputFormat = "text" | "json" | "markdown";

export interface ServeCommand {
  readonly command: "serve";
}

export interface McpCommand {
  readonly command: "mcp";
}

export interface DaemonCommand {
  readonly command: "start" | "stop" | "status";
}

export interface IngestCommand {
  readonly command: "ingest";
  readonly file?: string | undefined;
  readonly stdin: boolean;
  readonly tool: string;
  readonly project?: string | undefined;
  readonly format: InputFormat;
  readonly output?: OutputFormat;
}

export interface ContextCommand {
  readonly command: "context";
  readonly project?: string | undefined;
  readonly query?: string | undefined;
  readonly type?: MemoryType | undefined;
  readonly scope?: MemoryScope | undefined;
  readonly output: OutputFormat;
}

export interface HelpCommand {
  readonly command: "help";
}

export type ManagementOperation = "listMemoryCandidates" | "approveMemoryCandidate" | "rejectMemoryCandidate"
  | "approveAllCandidates" | "rejectAllCandidates" | "updateMemory" | "supersedeMemory"
  | "reviewStaleMemories" | "exportStaticMemoryFiles" | "getDiagnostics" | "listAuditLog"
  | "configureGitHubTeamMode" | "getCollaborationStatus";

export interface ManagementCommand {
  readonly command: "manage";
  readonly operation: ManagementOperation;
  readonly input: EndpointRequest<ManagementOperation>;
  readonly output: OutputFormat;
}

export type CliCommand = ServeCommand | McpCommand | DaemonCommand | IngestCommand | ContextCommand | HelpCommand | ManagementCommand;

export interface ParseError {
  readonly ok: false;
  readonly error: string;
}

export interface ParseSuccess {
  readonly ok: true;
  readonly value: CliCommand;
}

export type ParseResult = ParseSuccess | ParseError;

function getFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= args.length) return undefined;
  const value = args[index + 1];
  if (value !== undefined && value.startsWith("--")) return undefined;
  return value;
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const args = argv.slice(2);

  if (args.length === 0) {
    return { ok: true, value: { command: "mcp" } };
  }

  const subcommand = args[0];

  if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    return { ok: true, value: { command: "help" } };
  }

  if (subcommand === "serve") {
    return { ok: true, value: { command: "serve" } };
  }

  if (subcommand === "mcp" || subcommand === "start" || subcommand === "stop" || subcommand === "status") {
    return { ok: true, value: { command: subcommand } };
  }

  if (subcommand === "ingest") {
    const file = getFlag(args, "file");
    const stdin = hasFlag(args, "stdin");
    const tool = getFlag(args, "tool") ?? "unknown";
    const project = getFlag(args, "project");
    const formatRaw = getFlag(args, "format") ?? "auto";
    const output = getFlag(args, "output");
    if (output !== undefined && !isOutputFormat(output)) {
      return { ok: false, error: `Invalid output format: "${output}". Must be one of: text, json, markdown` };
    }

    if (!file && !stdin) {
      return { ok: false, error: "ingest requires --file <path> or --stdin" };
    }
    if (file && stdin) {
      return { ok: false, error: "ingest cannot use both --file and --stdin" };
    }

    const validFormats: InputFormat[] = ["auto", "text", "openai-chat"];
    if (!validFormats.includes(formatRaw as InputFormat)) {
      return { ok: false, error: `Invalid format: "${formatRaw}". Must be one of: auto, text, openai-chat` };
    }

    return {
      ok: true,
      value: { command: "ingest", file, stdin, tool, project, format: formatRaw as InputFormat, ...(output ? { output } : {}) }
    };
  }

  if (subcommand === "context") {
    const project = getFlag(args, "project");
    const query = getFlag(args, "query");
    const type = getFlag(args, "type");
    const scope = getFlag(args, "scope");
    const outputRaw = getFlag(args, "output") ?? "text";

    if (!isOutputFormat(outputRaw)) {
      return { ok: false, error: `Invalid output format: "${outputRaw}". Must be one of: text, json, markdown` };
    }
    if (type !== undefined && !isMemoryType(type)) return { ok: false, error: "Invalid memory type." };
    if (scope !== undefined && !isMemoryScope(scope)) return { ok: false, error: "Invalid memory scope." };

    return {
      ok: true,
      value: { command: "context", project, query, type, scope, output: outputRaw }
    };
  }

  if (subcommand && ["candidates", "memory", "export", "diagnostics", "audit", "team"].includes(subcommand)) {
    return parseManagement(args);
  }
  return { ok: false, error: `Unknown command: "${subcommand}". Use --help for available commands.` };
}

function isOutputFormat(value: string): value is OutputFormat {
  return value === "text" || value === "json" || value === "markdown";
}

function isMemoryType(value: string): value is MemoryType {
  return memoryTypes.some((type) => type === value);
}

function isMemoryScope(value: string): value is MemoryScope {
  return memoryScopes.some((scope) => scope === value);
}

function parseManagement(args: readonly string[]): ParseResult {
  const grouped = args[0] === "candidates" || args[0] === "memory" || args[0] === "team";
  const key = grouped ? `${args[0]} ${args[1] ?? ""}` : args[0] ?? "";
  const operations: Record<string, { name: ManagementOperation; flags?: string[]; id?: "candidateId" | "memoryId" }> = {
    "candidates list": { name: "listMemoryCandidates", flags: ["limit"] },
    "candidates approve": { name: "approveMemoryCandidate", id: "candidateId" },
    "candidates reject": { name: "rejectMemoryCandidate", id: "candidateId", flags: ["reason"] },
    "candidates approve-all": { name: "approveAllCandidates" },
    "candidates reject-all": { name: "rejectAllCandidates", flags: ["reason"] },
    "memory update": { name: "updateMemory", id: "memoryId", flags: ["content", "type", "scope", "tags"] },
    "memory supersede": { name: "supersedeMemory", id: "memoryId", flags: ["reason", "replacement-id"] },
    "memory stale": { name: "reviewStaleMemories", flags: ["stale-after-months"] },
    export: { name: "exportStaticMemoryFiles", flags: ["targets", "output-dir", "include-confidential", "preview"] },
    diagnostics: { name: "getDiagnostics", flags: ["severity", "code", "limit"] },
    audit: { name: "listAuditLog", flags: ["limit"] },
    "team configure": { name: "configureGitHubTeamMode", flags: ["host", "owner", "repo"] },
    "team status": { name: "getCollaborationStatus" },
  };
  const operation = operations[key];
  if (!operation) return { ok: false, error: `Unknown command: "${key}". Use --help for available commands.` };
  const options: Record<string, { type: "string" | "boolean" }> = {};
  for (const flag of ["project", "output", ...(operation.flags ?? [])]) {
    options[flag] = { type: flag === "preview" || flag === "include-confidential" ? "boolean" : "string" };
  }
  try {
    const { values, positionals } = parseOptions({ args: args.slice(grouped ? 2 : 1), options, allowPositionals: true });
    const output = values.output ?? "text";
    if (typeof output !== "string" || !isOutputFormat(output)) return { ok: false, error: "Invalid output format. Must be one of: text, json, markdown" };
    if (positionals.length !== (operation.id ? 1 : 0)) return { ok: false, error: operation.id ? `${key} requires exactly one ID.` : `${key} does not accept positional arguments.` };
    const input: Record<string, unknown> = { projectRoot: process.cwd() };
    if (values.project !== undefined) input.projectId = values.project;
    if (operation.id) input[operation.id] = positionals[0];
    const fields: Record<string, string> = {
      "replacement-id": "replacementId", "stale-after-months": "staleAfterMonths",
      "output-dir": "outputDir", "include-confidential": "includeConfidential",
    };
    for (const flag of operation.flags ?? []) {
      const value = values[flag];
      if (value === undefined || ["host", "owner", "repo"].includes(flag)) continue;
      input[fields[flag] ?? flag] = flag === "limit" || flag === "stale-after-months"
        ? Number(value) : (flag === "tags" || flag === "targets") && typeof value === "string"
          ? value.split(",").map((item) => item.trim()).filter(Boolean) : value;
    }
    if (operation.name === "configureGitHubTeamMode") {
      input.repository = { host: values.host ?? "github.com", owner: values.owner, name: values.repo };
    }
    if (operation.name === "updateMemory" && !["content", "type", "scope", "tags"].some((field) => field in input)) {
      return { ok: false, error: "memory update requires --content, --type, --scope, or --tags." };
    }
    const parsed = endpoints[operation.name].request.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: `Invalid ${key} options: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}` };
    }
    return { ok: true, value: { command: "manage", operation: operation.name, input: parsed.data, output } };
  } catch (error) {
    if (error instanceof TypeError) return { ok: false, error: error.message };
    throw error;
  }
}

export const USAGE = `Usage: openmembrane <command> [options]

Commands:
  mcp                       Start MCP stdio server (default when no command is given)
  serve                     Run the local daemon in the foreground
  start                     Start the local daemon detached
  stop                      Gracefully stop the local daemon
  status                    Check whether the local daemon is running
  ingest                    Submit a session transcript for memory extraction
  context                   Retrieve relevant memories for a project
  candidates list | approve <id> | reject <id> | approve-all | reject-all
  memory update <id> | supersede <id> | stale
  export                    Export static memory files (or --preview without writes)
  diagnostics               List local diagnostic events
  audit                     List recent audit events
  team configure | status   Configure or inspect GitHub Team mode

Ingest options:
  --file <path>             Path to session transcript file
  --stdin                   Read transcript from stdin
  --tool <name>             Source tool name (default: "unknown")
  --project <id>            Project identifier (default: env/cwd basename)
  --format <type>           Input format: auto, text, openai-chat (default: auto)
  --output <format>         text, json, markdown (default: json for ingest)

Context options:
  --project <id>            Project identifier (default: env/cwd basename)
  --query <string>          Relevance query for ranking
  --type <type>             Filter by memory type
  --scope <scope>           Filter by scope
  --output <format>         Output format: text, json, markdown (default: text)

Management options:
  --project <id>            Override the project ID
  --output <format>         text, json, markdown (default: text)
  --limit <number>          candidates list, diagnostics, audit
  --reason <text>           Reject candidates or supersede a memory
  --content <text>          memory update: replacement content
  --type <type>             memory update: memory type
  --scope <scope>           memory update: memory scope
  --tags <a,b>              memory update: comma-separated tags
  --replacement-id <id>     memory supersede: replacement memory
  --stale-after-months <n>  memory stale: age threshold (default: 6)
  --targets <a,b>           export: agents,claude,copilot,cursor,project_memory
  --output-dir <path>       export: directory relative to the caller's project
  --include-confidential    export: explicitly include confidential memories
  --preview                 export: render files without writing them
  --severity <severity>     diagnostics: debug,info,warning,error
  --code <code>             diagnostics: filter by code
  --host <host>             team configure: GitHub host (default: github.com)
  --owner <owner>           team configure: private repository owner (required)
  --repo <name>             team configure: private repository name (required)

Start the daemon with "openmembrane start" before using client commands.

Environment:
  OPENMEMBRANE_HOME         Storage directory (default: .openmembrane)
  OPENMEMBRANE_PROJECT_ID   Default project ID (default: cwd basename)
  OPENMEMBRANE_STORAGE_BACKEND  Storage backend: json, sqlite (default: json)
`;
import { parseArgs as parseOptions } from "node:util";
import { memoryScopes, memoryTypes } from "@openmembrane/core";
import type { MemoryScope, MemoryType } from "@openmembrane/core";
import { endpoints } from "@openmembrane/protocol";
import type { EndpointRequest } from "@openmembrane/protocol";
