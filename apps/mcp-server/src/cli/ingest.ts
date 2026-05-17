import { readFile } from "node:fs/promises";
import { createOpenMembrainContext, resolveProjectId } from "../context";
import type { IngestCommand } from "./parseArgs";
import { parseSessionContent } from "./parsers/index";
import { printPendingReminder } from "./pendingReminder";

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

  const context = createOpenMembrainContext();
  try {
    const projectId = resolveProjectId(context, cmd.project);

    const result = await context.ingestionService.ingest({
      projectId,
      transcript,
      tool: cmd.tool
    });

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    await printPendingReminder(context.pendingCandidateStore, projectId);
  } finally {
    context.close?.();
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
