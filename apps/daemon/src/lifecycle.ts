import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { resolveDaemonPaths } from "@openmembrane/protocol";
import type { DaemonPathOptions } from "@openmembrane/protocol";
import { ZodError } from "zod";
import { sendRequest } from "../../../packages/client/src/transport";
import { daemonOwnsLock, processAlive, readLock } from "./lock";
import { startDaemon } from "./server";
import { createLogger } from "./logging";
import { DaemonLifecycleError } from "./errors";

async function running(paths: DaemonPathOptions = {}): Promise<boolean> {
  let lock;
  try {
    lock = await readLock(resolveDaemonPaths(paths).runDir);
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof ZodError)) throw error;
    await (await createLogger(paths.homeDir)).write("lock_invalid", undefined, "DAEMON_LOCK_INVALID");
    // Startup owns recovery and the grace period; preflight must not block it.
    return false;
  }
  if (!lock?.endpoint || !processAlive(lock.pid)) return false;
  if (!await daemonOwnsLock(resolveDaemonPaths(paths).runDir, lock)) return false;
  try {
    const health = await sendRequest({ endpoint: lock.endpoint, method: "GET", path: "/v1/health", timeoutMs: 1000 });
    return health.status === 200;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "E_DAEMON_NOT_RUNNING" || error.code === "E_REQUEST_TIMEOUT")) return false;
    throw error;
  }
}

export async function runDaemonCommand(command: "serve" | "start" | "stop" | "status"): Promise<void> {
  if (command === "serve") {
    const daemon = await startDaemon();
    const shutdown = (): void => { void daemon.close(); };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    try {
      process.stdout.write("OpenMembrane daemon is running.\n");
      await daemon.closed;
    } finally {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    }
    return;
  }
  if (command === "status") {
    const active = await running();
    process.stdout.write(active ? "OpenMembrane daemon is running.\n" : "OpenMembrane daemon is not running.\n");
    if (!active) process.exitCode = 1;
    return;
  }
  if (command === "stop") {
    const paths = resolveDaemonPaths();
    const lock = await readLock(paths.runDir);
    if (!lock?.endpoint || !await daemonOwnsLock(paths.runDir, lock)) {
      process.stdout.write("OpenMembrane daemon is not running.\n");
      return;
    }
    const token = (await readFile(paths.tokenPath, "utf8")).trim();
    const result = await sendRequest({
      endpoint: lock.endpoint, method: "POST", path: "/v1/daemon/stop", token, timeoutMs: 1000,
      body: JSON.stringify({ instanceId: lock.instanceId }),
    });
    if (result.status !== 200) throw new DaemonLifecycleError("DAEMON_STOP_REJECTED", "Daemon stop was rejected.");
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const current = await readLock(paths.runDir);
      if (!current || current.instanceId !== lock.instanceId) {
        process.stdout.write("OpenMembrane daemon stopped.\n");
        return;
      }
      await delay(100);
    }
    throw new DaemonLifecycleError("DAEMON_STOP_TIMEOUT", "The daemon did not finish shutting down.");
  }
  if (await running()) {
    process.stdout.write("OpenMembrane daemon is already running.\n");
    return;
  }
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, "serve"], {
    detached: true, stdio: "ignore", windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await running()) {
      process.stdout.write("OpenMembrane daemon started.\n");
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null || (child.pid !== undefined && !processAlive(child.pid))) {
      throw new DaemonLifecycleError("DAEMON_START_FAILED", "Daemon startup failed. See the local daemon log.");
    }
    await delay(100);
  }
  child.kill();
  throw new DaemonLifecycleError("DAEMON_START_TIMEOUT", "Daemon startup timed out. See the local daemon log.");
}

export async function reportDaemonFailure(error: unknown): Promise<void> {
  const systemCode = error instanceof Error && "code" in error && typeof error.code === "string" &&
    /^E[A-Z0-9_]+$/.test(error.code) ? error.code : undefined;
  const code = error instanceof DaemonLifecycleError ? error.code : systemCode ?? "DAEMON_LIFECYCLE_ERROR";
  try {
    await (await createLogger()).write("lifecycle_failed", undefined, code);
  } catch {
    process.stderr.write("OpenMembrane daemon could not write its log.\n");
  }
  process.stderr.write(error instanceof DaemonLifecycleError
    ? `${error.message}\n`
    : "OpenMembrane daemon command failed. Check the local daemon log and private-file permissions.\n");
  process.exitCode = 1;
}
