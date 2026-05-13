export type InputFormat = "auto" | "text" | "openai-chat";
export type OutputFormat = "text" | "json" | "markdown";

export interface ServeCommand {
  readonly command: "serve";
}

export interface IngestCommand {
  readonly command: "ingest";
  readonly file?: string | undefined;
  readonly stdin: boolean;
  readonly tool: string;
  readonly project?: string | undefined;
  readonly format: InputFormat;
}

export interface ContextCommand {
  readonly command: "context";
  readonly project?: string | undefined;
  readonly query?: string | undefined;
  readonly type?: string | undefined;
  readonly scope?: string | undefined;
  readonly output: OutputFormat;
}

export interface HelpCommand {
  readonly command: "help";
}

export type CliCommand = ServeCommand | IngestCommand | ContextCommand | HelpCommand;

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
    return { ok: true, value: { command: "serve" } };
  }

  const subcommand = args[0];

  if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    return { ok: true, value: { command: "help" } };
  }

  if (subcommand === "serve") {
    return { ok: true, value: { command: "serve" } };
  }

  if (subcommand === "ingest") {
    const file = getFlag(args, "file");
    const stdin = hasFlag(args, "stdin");
    const tool = getFlag(args, "tool") ?? "unknown";
    const project = getFlag(args, "project");
    const formatRaw = getFlag(args, "format") ?? "auto";

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
      value: { command: "ingest", file, stdin, tool, project, format: formatRaw as InputFormat }
    };
  }

  if (subcommand === "context") {
    const project = getFlag(args, "project");
    const query = getFlag(args, "query");
    const type = getFlag(args, "type");
    const scope = getFlag(args, "scope");
    const outputRaw = getFlag(args, "output") ?? "text";

    const validOutputs: OutputFormat[] = ["text", "json", "markdown"];
    if (!validOutputs.includes(outputRaw as OutputFormat)) {
      return { ok: false, error: `Invalid output format: "${outputRaw}". Must be one of: text, json, markdown` };
    }

    return {
      ok: true,
      value: { command: "context", project, query, type, scope, output: outputRaw as OutputFormat }
    };
  }

  return { ok: false, error: `Unknown command: "${subcommand}". Use "serve", "ingest", or "context".` };
}

export const USAGE = `Usage: openmembrain <command> [options]

Commands:
  serve                     Start MCP server (default)
  ingest                    Submit a session transcript for memory extraction
  context                   Retrieve relevant memories for a project

Ingest options:
  --file <path>             Path to session transcript file
  --stdin                   Read transcript from stdin
  --tool <name>             Source tool name (default: "unknown")
  --project <id>            Project identifier (default: env/cwd basename)
  --format <type>           Input format: auto, text, openai-chat (default: auto)

Context options:
  --project <id>            Project identifier (default: env/cwd basename)
  --query <string>          Relevance query for ranking
  --type <type>             Filter by memory type
  --scope <scope>           Filter by scope
  --output <format>         Output format: text, json, markdown (default: text)

Environment:
  OPENMEMBRAIN_HOME         Storage directory (default: .openmembrain)
  OPENMEMBRAIN_PROJECT_ID   Default project ID (default: cwd basename)
  OPENMEMBRAIN_STORAGE_BACKEND  Storage backend: json, sqlite (default: json)
`;
