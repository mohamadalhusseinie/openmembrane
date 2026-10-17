import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { acquireLock, processAlive, readLock } from "../../../apps/daemon/src/lock";
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

it.skipIf(process.platform !== "linux")("recovers a lock and recovery guard owned by a real unreaped child", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "om-zombie-"));
  const parent = spawn(process.execPath, ["-e", `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 2000)"], { stdio: "ignore" });
    child.once("spawn", () => {
      process.stdout.write(String(child.pid) + "\\n", () => process.kill(process.pid, "SIGSTOP"));
    });
    child.once("exit", () => process.exit(0));
  `], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = once(parent, "exit");
  let childPid: number | undefined;
  try {
    let output = "";
    parent.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    await expect.poll(() => output, { timeout: 5000 }).toMatch(/^\d+\n$/);
    childPid = Number(output.trim());
    const identity = await readProcessIdentity(childPid);
    expect(identity).toMatch(/^linux:/);
    await expect.poll(async () => {
      const record = await readFile(`/proc/${childPid}/stat`, "utf8");
      return record.slice(record.lastIndexOf(")") + 1).trim().split(/\s+/)[0];
    }, { timeout: 5000 }).toBe("Z");
    expect(processAlive(childPid)).toBe(true);
    expect(await readProcessIdentity(childPid)).toBeUndefined();
    const stale = JSON.stringify({
      pid: childPid, instanceId: randomUUID(), endpoint: null, processIdentity: identity,
    });
    await writeFile(join(runDir, "daemon.lock"), stale);
    await writeFile(join(runDir, `recovery-${createHash("sha256").update(stale).digest("hex")}`), stale);
    const replacement = await acquireLock(runDir);
    expect((await readLock(runDir))?.instanceId).toBe(replacement.record.instanceId);
    await replacement.release();
  } finally {
    if (childPid !== undefined && processAlive(childPid)) process.kill(childPid, "SIGKILL");
    if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGCONT");
    await Promise.race([exited, delay(3000)]);
    if (parent.exitCode === null && parent.signalCode === null) {
      parent.kill("SIGKILL");
      await exited;
    }
    await rm(runDir, { recursive: true, force: true });
  }
}, 15_000);
