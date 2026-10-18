import { closeSync, readFileSync } from "node:fs";
import { open } from "node:fs/promises";
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
  if (!worker) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const payload = parseHookInput(Buffer.concat(chunks).toString("utf8"));
    // An inherited descriptor survives rollout deletion without copying it during SessionEnd.
    const file = await open(payload.transcriptPath, "r");
    try {
      await launchWorker(fileURLToPath(import.meta.url),
        ["--ingest", cli, logPath, payload.cwd, payload.sessionId], payload.cwd, undefined, logPath, file.fd);
    } finally {
      await file.close();
    }
    return;
  }
  const cwd = process.argv[5];
  const sessionId = process.argv[6];
  if (!cwd || !isAbsolute(cwd) || !sessionId?.trim()) throw new Error("Invalid ingestion worker arguments.");
  let content: string;
  try {
    content = readFileSync(3, "utf8");
  } finally {
    closeSync(3);
  }
  const transcript = sessionTranscript(content);
  if (!transcript) return;
  await runCli(cli, ["start"], cwd);
  for (const chunk of prepareTranscriptChunks(transcript)) {
    if (chunk.trim()) await runCli(cli, [
      "ingest", "--stdin", "--tool", "codex", "--format", "text", "--session-id", sessionId,
    ], cwd, chunk);
  }
}

main().catch(() => {
  process.stderr.write("[openmembrane] Codex capture failed. Check openmembrane status, diagnostics and openmembrane-capture.log, then retry ingestion or reinstall the adapter.\n");
  process.exitCode = 1;
});
