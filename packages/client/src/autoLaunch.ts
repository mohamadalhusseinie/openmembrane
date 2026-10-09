import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { E_DAEMON_NOT_RUNNING, OpenMembraneClientError } from "./errors";

export type AutoLaunchHook = () => void | Promise<void>;
export interface AutoLaunchOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}
export interface SpawnDaemonOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function createDaemonAutoLaunch(
  command: string,
  args: readonly string[] = [],
  options: SpawnDaemonOptions = {},
): AutoLaunchHook {
  return () => new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { ...options, detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", (cause) => reject(new OpenMembraneClientError(
      "E_DAEMON_LAUNCH_FAILED", "The OpenMembrane daemon could not be launched.", { cause },
    )));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function autoLaunchDaemon(
  launch: AutoLaunchHook,
  health: (remainingMs: number) => Promise<unknown>,
  options: AutoLaunchOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new OpenMembraneClientError("E_CLIENT_CONFIG", "Daemon startup timeouts must be positive finite numbers.");
  }
  await launch();
  const deadline = Date.now() + timeoutMs;
  let cause: unknown;
  while (Date.now() < deadline) {
    try {
      await health(Math.max(1, deadline - Date.now()));
      return;
    } catch (error) {
      if (!(error instanceof OpenMembraneClientError) || error.origin === "daemon" ||
        (error.code !== E_DAEMON_NOT_RUNNING && error.code !== "E_REQUEST_TIMEOUT")) throw error;
      cause = error;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await sleep(Math.min(pollIntervalMs, remaining));
  }
  throw new OpenMembraneClientError(E_DAEMON_NOT_RUNNING, "The OpenMembrane daemon did not become ready before the startup timeout.", { cause });
}
