import { randomUUID } from "node:crypto";
import { link, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { daemonEndpointSchema } from "@openmembrane/protocol";
import type { DaemonEndpoint } from "@openmembrane/protocol";
import { isMissing, writePrivateFile } from "./privateFiles";
import { DaemonLifecycleError } from "./errors";

const lockSchema = z.object({
  pid: z.number().int().positive(),
  instanceId: z.string().uuid(),
  endpoint: daemonEndpointSchema.nullable(),
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
  release(): Promise<void>;
}

export async function acquireLock(runDir: string): Promise<LockHandle> {
  const path = join(runDir, "daemon.lock");
  const record: DaemonLock = { pid: process.pid, instanceId: randomUUID(), endpoint: null };
  const candidate = join(runDir, `lock-${record.instanceId}`);
  await writePrivateFile(candidate, JSON.stringify(record));
  try {
    await link(candidate, path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    // Serialize stale-lock recovery so simultaneous starters cannot unlink a new owner's lock.
    const recoveryPath = join(runDir, "recovery.lock");
    try {
      await link(candidate, recoveryPath);
    } catch (recoveryError) {
      if (!(recoveryError instanceof Error && "code" in recoveryError && recoveryError.code === "EEXIST")) throw recoveryError;
      const recovery = await readRecord(recoveryPath);
      if (recovery && processAlive(recovery.pid)) {
        throw new DaemonLifecycleError("DAEMON_RECOVERING", "Another daemon is recovering its lock.");
      }
      if ((await readRecord(recoveryPath))?.instanceId !== recovery?.instanceId) {
        throw new DaemonLifecycleError("DAEMON_RECOVERING", "Another daemon is recovering its lock.");
      }
      await unlink(recoveryPath).catch((unlinkError: unknown) => { if (!isMissing(unlinkError)) throw unlinkError; });
      await link(candidate, recoveryPath);
    }
    try {
      let existing: DaemonLock | undefined;
      try {
        existing = await readLock(runDir);
      } catch (readError) {
        if (!(readError instanceof z.ZodError || readError instanceof SyntaxError)) throw readError;
        if (Date.now() - (await stat(path)).mtimeMs < 10_000) {
          throw new DaemonLifecycleError("DAEMON_STARTING", "Another daemon is starting.");
        }
      }
      if (existing && processAlive(existing.pid)) throw new DaemonLifecycleError("DAEMON_ALREADY_RUNNING", "A daemon is already running for this user.");
      await unlink(path).catch((unlinkError: unknown) => { if (!isMissing(unlinkError)) throw unlinkError; });
      await link(candidate, path);
    } finally {
      if ((await readRecord(recoveryPath))?.instanceId === record.instanceId) await unlink(recoveryPath);
    }
  } finally {
    await unlink(candidate);
  }
  return {
    record,
    async publish(endpoint) {
      const current = await readLock(runDir);
      if (current?.instanceId !== record.instanceId) throw new DaemonLifecycleError("DAEMON_LOCK_LOST", "Daemon lock ownership was lost.");
      record.endpoint = endpoint;
      await writePrivateFile(candidate, JSON.stringify(record));
      try {
        await rename(candidate, path);
      } finally {
        await unlink(candidate).catch((error: unknown) => { if (!isMissing(error)) throw error; });
      }
    },
    async release() {
      if ((await readLock(runDir))?.instanceId === record.instanceId) await unlink(path);
    },
  };
}
