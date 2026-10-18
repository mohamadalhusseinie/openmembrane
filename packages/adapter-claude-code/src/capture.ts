import { spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseHookInput, sessionTranscript } from "./transcript";

async function run(cli: string, args: string[], cwd: string, input?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd, stdio: ["pipe", "ignore", "inherit"], windowsHide: true,
    });
    child.once("error", reject);
    child.stdin.on("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`OpenMembrane ${args[0]} failed (${signal ?? code}).`));
    });
    child.stdin.end(input);
  });
}

async function main(): Promise<void> {
  const cli = process.argv[2];
  const logPath = process.argv[3];
  if (!cli || !isAbsolute(cli)) throw new Error("Missing installed OpenMembrane CLI path; reinstall the adapter.");
  if (!logPath || !isAbsolute(logPath)) throw new Error("Missing capture log path; reinstall the adapter.");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const payload = parseHookInput(Buffer.concat(chunks).toString("utf8"));
  if (!isAbsolute(payload.cwd) || !isAbsolute(payload.transcriptPath)) {
    throw new Error("Claude Code hook paths must be absolute.");
  }
  const transcript = sessionTranscript(await readFile(payload.transcriptPath, "utf8"));
  if (!transcript) return;
  await run(cli, ["start"], payload.cwd);
  const log = await open(logPath, "a", 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "ingest", "--stdin", "--tool", "claude-code", "--format", "text"], {
        cwd: payload.cwd, detached: true, stdio: ["pipe", "ignore", log.fd], windowsHide: true,
      });
      child.once("error", reject);
      const stdin = child.stdin;
      if (!stdin) {
        reject(new Error("Could not open ingestion input."));
        return;
      }
      stdin.once("error", reject);
      stdin.end(transcript, () => {
        child.unref();
        resolve();
      });
    });
  } finally {
    await log.close();
  }
}

main().catch(() => {
  // Never echo transcript content or provider errors into Claude's conversation.
  process.stderr.write("[openmembrane] Claude Code capture failed. Check openmembrane status, diagnostics and openmembrane-capture.log, then retry ingestion or reinstall the adapter.\n");
  process.exitCode = 1;
});
