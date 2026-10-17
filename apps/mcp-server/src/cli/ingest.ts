import { readFile } from "node:fs/promises";
import { OpenMembraneClient, OpenMembraneClientError } from "@openmembrane/client";
import type { IngestCommand } from "./parseArgs";
import { parseSessionContent } from "./parsers/index";
import { printPendingReminderCount } from "./pendingReminder";
import { formatResult } from "./formatters";

export async function runIngest(cmd: IngestCommand): Promise<void> {
  let content: string;

  if (cmd.stdin) {
    content = await readStdin();
  } else if (cmd.file) {
    try {
      content = await readFile(cmd.file, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: Could not read file "${cmd.file}": ${message}\n`);
      process.exitCode = 1;
      return;
    }
  } else {
    process.stderr.write("Error: --file or --stdin is required.\n");
    process.exitCode = 1;
    return;
  }

  if (content.trim().length === 0) {
    process.stderr.write("Error: Input is empty.\n");
    process.exitCode = 1;
    return;
  }

  let transcript: string;
  try {
    transcript = parseSessionContent(content, cmd.format);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: Failed to parse input: ${message}\n`);
    process.exitCode = 1;
    return;
  }

  const client = new OpenMembraneClient({ requestTimeoutMs: cmd.timeoutMs ?? 30 * 60_000 });
  const input = { ...(cmd.project ? { projectId: cmd.project } : {}) };
  const result = await client.ingest({ ...input, transcript, tool: cmd.tool }).catch((error: unknown) => {
    if (error instanceof OpenMembraneClientError && error.code === "E_REQUEST_TIMEOUT") {
      process.stderr.write("Warning: Ingestion may still be processing in the daemon. Check context and audit before retrying; a timeout does not mean nothing was saved.\n");
    }
    throw error;
  });
  process.stdout.write(formatResult(result, cmd.output ?? "json") + "\n");
  try {
    printPendingReminderCount((await client.listMemoryCandidates({ ...input, limit: null })).length);
  } catch (error) {
    if (!(error instanceof OpenMembraneClientError)) throw error;
    process.stderr.write(`Warning: Ingestion completed, but the pending reminder is unavailable [${error.code}]${error.diagnosticId ? ` (diagnostic: ${error.diagnosticId})` : ""}.\n`);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}
