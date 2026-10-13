import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { DaemonLifecycleError } from "./errors";
import { isMissing } from "./privateFiles";

const exec = promisify(execFile);
let currentIdentity: Promise<string | undefined> | undefined;

async function lookup(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === "linux") {
      const record = await readFile(`/proc/${pid}/stat`, "utf8");
      const start = record.slice(record.lastIndexOf(")") + 1).trim().split(/\s+/)[19];
      if (start === undefined || !/^\d+$/.test(start)) throw new Error("Invalid process start record.");
      const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      return `linux:${boot}:${start}`;
    }
    if (process.platform === "win32") {
      const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `$ErrorActionPreference = 'Stop'; try { [System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().Ticks } catch [System.ArgumentException] { 'missing' }`,
      ], { windowsHide: true, timeout: 5000 });
      const start = stdout.trim();
      if (start === "missing") return undefined;
      if (!/^\d+$/.test(start)) throw new Error("Invalid process start record.");
      return `win32:${start}`;
    }
    const { stdout } = await exec("ps", ["-p", String(pid), "-o", "lstart="], {
      env: { ...process.env, LC_ALL: "C" }, timeout: 5000,
    });
    const start = stdout.trim().replace(/\s+/g, " ");
    if (start.length === 0) throw new Error("Invalid process start record.");
    return `${process.platform}:${start}`;
  } catch (cause) {
    if (isMissing(cause) && process.platform === "linux") return undefined;
    if (process.platform !== "linux" && process.platform !== "win32" && cause instanceof Error &&
      "code" in cause && cause.code === 1 && "stdout" in cause && cause.stdout === "") return undefined;
    const error = new DaemonLifecycleError("DAEMON_PROCESS_IDENTITY", "The daemon could not verify local process identity.");
    error.cause = cause;
    throw error;
  }
}

export async function readProcessIdentity(pid: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new DaemonLifecycleError("DAEMON_PROCESS_IDENTITY", "Invalid process identity request.");
  if (pid !== process.pid) return lookup(pid);
  currentIdentity ??= lookup(pid);
  const pending = currentIdentity;
  try {
    const identity = await pending;
    if (identity === undefined && currentIdentity === pending) currentIdentity = undefined;
    return identity;
  } catch (error) {
    if (currentIdentity === pending) currentIdentity = undefined;
    throw error;
  }
}
