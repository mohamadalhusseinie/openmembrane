import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

export async function runCli(cli: string, args: string[], cwd: string, input?: string): Promise<void> {
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

export async function launchWorker(
  script: string, args: string[], cwd: string, input: string | undefined, logPath: string, inputFile?: number,
): Promise<void> {
  const log = await open(logPath, "a", 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [script, ...args], {
        cwd, detached: true, stdio: [input === undefined ? "ignore" : "pipe", "ignore", log.fd,
          ...(inputFile === undefined ? [] : [inputFile])], windowsHide: true,
      });
      child.once("error", reject);
      if (input === undefined) {
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
        return;
      }
      const stdin = child.stdin;
      if (!stdin) {
        reject(new Error("Could not open ingestion input."));
        return;
      }
      stdin.once("error", reject);
      stdin.end(input, () => {
        child.unref();
        resolve();
      });
    });
  } finally {
    await log.close();
  }
}
