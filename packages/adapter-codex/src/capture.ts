import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTranscriptChunks } from "@openmembrane/core";
import { launchWorker, runCli } from "../../adapter-hooks/src/process";
import { parseHookInput, sessionTranscript } from "./transcript";

async function main(): Promise<void> {
  const worker = process.argv[2] === "--ingest";
  const cli = process.argv[worker ? 3 : 2];
  const logPath = process.argv[worker ? 4 : 3];
  if (!cli || !isAbsolute(cli) || !logPath || !isAbsolute(logPath)) {
    throw new Error("Missing installed CLI or log path; reinstall the adapter.");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const input = Buffer.concat(chunks).toString("utf8");
  const payload = parseHookInput(input);
  if (!worker) {
    // SessionEnd allows only three seconds: defer file reads and daemon startup.
    await launchWorker(fileURLToPath(import.meta.url), ["--ingest", cli, logPath], payload.cwd, input, logPath);
    return;
  }
  const transcript = sessionTranscript(await readFile(payload.transcriptPath, "utf8"));
  if (!transcript) return;
  await runCli(cli, ["start"], payload.cwd);
  for (const chunk of prepareTranscriptChunks(transcript)) {
    if (chunk.trim()) await runCli(cli, [
      "ingest", "--stdin", "--tool", "codex", "--format", "text", "--session-id", payload.sessionId,
    ], payload.cwd, chunk);
  }
}

main().catch(() => {
  process.stderr.write("[openmembrane] Codex capture failed. Check openmembrane status, diagnostics and openmembrane-capture.log, then retry ingestion or reinstall the adapter.\n");
  process.exitCode = 1;
});
