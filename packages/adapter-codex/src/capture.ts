import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTranscriptChunks } from "@openmembrane/core";
import { launchWorker, runCli } from "../../adapter-hooks/src/process";
import { object } from "../../adapter-hooks/src/settings";
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
  if (!worker) {
    const payload = parseHookInput(input);
    // Codex may remove the rollout as soon as SessionEnd returns.
    const transcript = await readFile(payload.transcriptPath, "utf8");
    await launchWorker(fileURLToPath(import.meta.url), ["--ingest", cli, logPath], payload.cwd,
      JSON.stringify({ event: input, transcript }), logPath);
    return;
  }
  const snapshot: unknown = JSON.parse(input);
  if (!object(snapshot) || typeof snapshot.event !== "string" || typeof snapshot.transcript !== "string") {
    throw new Error("Invalid ingestion snapshot.");
  }
  const payload = parseHookInput(snapshot.event);
  const transcript = sessionTranscript(snapshot.transcript);
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
