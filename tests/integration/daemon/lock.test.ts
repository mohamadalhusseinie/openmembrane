import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { acquireLock, readLock } from "../../../apps/daemon/src/lock";
import { readProcessIdentity } from "../../../apps/daemon/src/processIdentity";

it("elects only one successor when concurrent starters encounter an interrupted stale-lock recovery", async () => {
  for (let round = 0; round < 20; round++) {
    const runDir = await mkdtemp(join(tmpdir(), "om-lock-"));
    try {
      const stale = JSON.stringify({ pid: 2147483647, instanceId: randomUUID(), endpoint: null });
      await writeFile(join(runDir, "daemon.lock"), stale);
      const guard = `recovery-${createHash("sha256").update(stale).digest("hex")}`;
      await writeFile(join(runDir, guard), JSON.stringify({
        pid: 2147483647, instanceId: randomUUID(), endpoint: null,
      }));
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => acquireLock(runDir)));
      const owners = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
      try {
        expect(owners).toHaveLength(1);
        expect((await readLock(runDir))?.instanceId).toBe(owners[0]!.record.instanceId);
      } finally {
        await Promise.all(owners.map((owner) => owner.release()));
      }
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }
});

it("protects unpublished startup locks during the grace period but recovers old reused PIDs", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "om-lock-"));
  const path = join(runDir, "daemon.lock");
  try {
    await writeFile(path, JSON.stringify({ pid: process.pid, instanceId: randomUUID(), endpoint: null }));
    await expect(acquireLock(runDir)).rejects.toMatchObject({ code: "DAEMON_ALREADY_RUNNING" });
    const old = new Date(Date.now() - 20_000);
    await utimes(path, old, old);
    const lock = await acquireLock(runDir);
    await lock.release();
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

it("holds the recovery election through cleanup even after the startup grace expires", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "om-lock-"));
  try {
    const lock = await acquireLock(runDir);
    expect(await lock.protectCleanup()).toBe(true);
    const old = new Date(Date.now() - 20_000);
    await utimes(join(runDir, "daemon.lock"), old, old);
    await expect(acquireLock(runDir)).rejects.toMatchObject({ code: "DAEMON_RECOVERING" });
    await lock.release();
    const replacement = await acquireLock(runDir);
    expect(await lock.protectCleanup()).toBe(false);
    await replacement.release();
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

it("recovers interrupted guards with reused live PIDs while preserving actual process ownership", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "om-lock-"));
  try {
    const stale = JSON.stringify({ pid: 2147483647, instanceId: randomUUID(), endpoint: null });
    await writeFile(join(runDir, "daemon.lock"), stale);
    const guard = join(runDir, `recovery-${createHash("sha256").update(stale).digest("hex")}`);
    await writeFile(guard, JSON.stringify({
      pid: process.pid, instanceId: randomUUID(), endpoint: null, processIdentity: "previous-process",
    }));
    const lock = await acquireLock(runDir);
    expect(lock.record.processIdentity).toBe(await readProcessIdentity(process.pid));
    await expect(acquireLock(runDir)).rejects.toMatchObject({ code: "DAEMON_ALREADY_RUNNING" });
    await lock.release();
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

it("uses a bounded startup grace for legacy recovery guards without process-start identity", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "om-lock-"));
  try {
    const stale = JSON.stringify({ pid: 2147483647, instanceId: randomUUID(), endpoint: null });
    await writeFile(join(runDir, "daemon.lock"), stale);
    const guard = join(runDir, `recovery-${createHash("sha256").update(stale).digest("hex")}`);
    await writeFile(guard, JSON.stringify({ pid: process.pid, instanceId: randomUUID(), endpoint: null }));
    await expect(acquireLock(runDir)).rejects.toMatchObject({ code: "DAEMON_RECOVERING" });
    const old = new Date(Date.now() - 20_000);
    await utimes(guard, old, old);
    const lock = await acquireLock(runDir);
    await lock.release();
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
