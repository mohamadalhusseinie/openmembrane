import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { acquireLock, readLock } from "../../../apps/daemon/src/lock";

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
