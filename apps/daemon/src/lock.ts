import { createHash, randomUUID } from "node:crypto";
import { link, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { daemonEndpointSchema } from "@openmembrane/protocol";
import type { DaemonEndpoint } from "@openmembrane/protocol";
import { isMissing, replacePrivateFile, writePrivateFile } from "./privateFiles";
import { DaemonLifecycleError } from "./errors";
import { sendRequest } from "../../../packages/client/src/transport";
import { OpenMembraneClientError } from "../../../packages/client/src/errors";
import { readProcessIdentity } from "./processIdentity";

const lockSchema = z.object({
  pid: z.number().int().positive(),
  instanceId: z.string().uuid(),
  endpoint: daemonEndpointSchema.nullable(),
  processIdentity: z.string().min(1).optional(),
}).strict();
export type DaemonLock = z.infer<typeof lockSchema>;

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    if (error instanceof Error && "code" in error && error.code === "EPERM") return true;
    throw error;
  }
}

export async function readLock(runDir: string): Promise<DaemonLock | undefined> {
  return readRecord(join(runDir, "daemon.lock"));
}

async function readRecord(path: string): Promise<DaemonLock | undefined> {
  try {
    return lockSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export interface LockHandle {
  record: DaemonLock;
  publish(endpoint: DaemonEndpoint): Promise<void>;
  protectCleanup(): Promise<boolean>;
  release(): Promise<void>;
}

export async function daemonOwnsLock(runDir: string, record: DaemonLock): Promise<boolean> {
  if (!processAlive(record.pid)) return false;
  if (record.processIdentity !== undefined) {
    return await readProcessIdentity(record.pid) === record.processIdentity;
  }
  if (record.endpoint === null) {
    return Date.now() - (await stat(join(runDir, "daemon.lock"))).mtimeMs < 10_000;
  }
  try {
    const token = (await readFile(join(runDir, "token"), "utf8")).trim();
    const result = await sendRequest({
      endpoint: record.endpoint, method: "GET", path: "/v1/daemon/identity", token, timeoutMs: 1000,
    });
    return result.status === 200 && typeof result.value === "object" && result.value !== null &&
      "instanceId" in result.value && result.value.instanceId === record.instanceId;
  } catch (error) {
    if (error instanceof OpenMembraneClientError && error.code === "E_REQUEST_TIMEOUT") {
      throw new DaemonLifecycleError("DAEMON_OWNERSHIP_UNCERTAIN", "Daemon ownership verification timed out; the lock was not reclaimed.");
    }
    if (isMissing(error) || (error instanceof OpenMembraneClientError && error.code === "E_DAEMON_NOT_RUNNING")) return false;
    throw error;
  }
}

async function acquireRecovery(runDir: string, candidate: string, snapshot: string): Promise<string> {
  let generation = createHash("sha256").update(snapshot).digest("hex");
  for (let attempt = 0; attempt < 10; attempt++) {
    const path = join(runDir, `recovery-${generation}`);
    try {
      await link(candidate, path);
      return path;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const holder = await readRecord(path);
      let owned = false;
      if (holder && processAlive(holder.pid)) {
        owned = holder.processIdentity !== undefined
          ? await readProcessIdentity(holder.pid) === holder.processIdentity
          : holder.endpoint !== null
            ? await daemonOwnsLock(runDir, holder)
            : Date.now() - (await stat(path)).mtimeMs < 10_000;
      }
      if (!holder || owned) {
        throw new DaemonLifecycleError("DAEMON_RECOVERING", "Another daemon is recovering its lock.");
      }
      // Elect a successor without unlinking the dead holder's guard: unlink/recreate has an ABA race.
      generation = createHash("sha256").update(`${generation}:${holder.instanceId}`).digest("hex");
    }
  }
  throw new DaemonLifecycleError("DAEMON_RECOVERING", "The daemon lock has too many interrupted recoveries.");
}

export async function acquireLock(runDir: string): Promise<LockHandle> {
  const path = join(runDir, "daemon.lock");
  const identity = await readProcessIdentity(process.pid);
  if (identity === undefined) throw new DaemonLifecycleError("DAEMON_PROCESS_IDENTITY", "The daemon could not identify its own process.");
  const record: DaemonLock = { pid: process.pid, instanceId: randomUUID(), endpoint: null, processIdentity: identity };
  const candidate = join(runDir, `lock-${record.instanceId}`);
  await writePrivateFile(candidate, JSON.stringify(record));
  try {
    await link(candidate, path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const snapshot = await readFile(path, "utf8");
    const recoveryPath = await acquireRecovery(runDir, candidate, snapshot);
    try {
      let existing: DaemonLock | undefined;
      try {
        existing = lockSchema.parse(JSON.parse(snapshot));
      } catch (readError) {
        if (!(readError instanceof z.ZodError || readError instanceof SyntaxError)) throw readError;
        if (Date.now() - (await stat(path)).mtimeMs < 10_000) {
          throw new DaemonLifecycleError("DAEMON_STARTING", "Another daemon is starting.");
        }
      }
      if (existing && await daemonOwnsLock(runDir, existing)) {
        throw new DaemonLifecycleError("DAEMON_ALREADY_RUNNING", "A daemon is already running for this user.");
      }
      if (await readFile(path, "utf8") !== snapshot) {
        throw new DaemonLifecycleError("DAEMON_RECOVERING", "Another daemon replaced the lock.");
      }
      await unlink(path);
      await link(candidate, path);
    } finally {
      if ((await readRecord(recoveryPath))?.instanceId === record.instanceId) await unlink(recoveryPath);
    }
  } finally {
    await unlink(candidate);
  }
  let cleanupGuard: string | undefined;
  return {
    record,
    async protectCleanup() {
      if (cleanupGuard) return true;
      const deadline = Date.now() + 5000;
      while (true) {
        const current = await readLock(runDir);
        if (current?.instanceId !== record.instanceId) return false;
        const snapshot = await readFile(path, "utf8");
        await writePrivateFile(candidate, JSON.stringify(record));
        try {
          cleanupGuard = await acquireRecovery(runDir, candidate, snapshot);
        } catch (error) {
          if (!(error instanceof DaemonLifecycleError && error.code === "DAEMON_RECOVERING") ||
            Date.now() >= deadline) throw error;
        } finally {
          await unlink(candidate);
        }
        if (cleanupGuard) {
          if ((await readLock(runDir))?.instanceId === record.instanceId) return true;
          await unlink(cleanupGuard);
          cleanupGuard = undefined;
          return false;
        }
        await delay(50);
      }
    },
    async publish(endpoint) {
      const current = await readLock(runDir);
      if (current?.instanceId !== record.instanceId) throw new DaemonLifecycleError("DAEMON_LOCK_LOST", "Daemon lock ownership was lost.");
      record.endpoint = endpoint;
      await writePrivateFile(candidate, JSON.stringify(record));
      try {
        await replacePrivateFile(candidate, path);
      } finally {
        await unlink(candidate).catch((error: unknown) => { if (!isMissing(error)) throw error; });
      }
    },
    async release() {
      try {
        if ((await readLock(runDir))?.instanceId === record.instanceId) await unlink(path);
      } finally {
        if (cleanupGuard) {
          await unlink(cleanupGuard);
          cleanupGuard = undefined;
        }
      }
    },
  };
}
