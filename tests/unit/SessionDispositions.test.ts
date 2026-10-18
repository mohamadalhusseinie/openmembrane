import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStores } from "@openmembrane/storage";
import type { AuditEvent } from "@openmembrane/core";
import * as jsonFile from "../../packages/storage/src/jsonFile";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe.each(["json", "sqlite"] as const)("session dispositions (%s)", (backend) => {
  it("indexes only handled identities, isolates projects, and persists across reopening", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "om-session-index-"));
    directories.push(baseDir);
    const stores = await createStores({ backend, baseDir });
    const append = async (id: string, type: AuditEvent["type"], details: Record<string, unknown>, projectId = "p1") =>
      stores.auditLogStore.append({ id, projectId, type, details, createdAt: "2026-05-08T00:00:00.000Z" });
    const [saved, rejected, policy, duplicate, foreign] = ["a", "b", "c", "d", "e"].map((char) => char.repeat(64));
    await append("saved", "memory_saved", { sessionFingerprint: saved });
    await append("rejected", "candidate_rejected", { sessionFingerprint: rejected, rejectedByUser: true });
    await append("policy", "candidate_rejected", { sessionFingerprint: policy });
    await append("duplicate", "candidate_rejected", { sessionFingerprint: duplicate, processedSession: true });
    await append("foreign", "memory_saved", { sessionFingerprint: foreign }, "p2");
    const queries = [saved!, rejected!, policy!, duplicate!, foreign!, saved!];
    expect(await stores.auditLogStore.findProcessedSessionFingerprints("p1", queries)).toEqual([saved, rejected, duplicate]);
    stores.close?.();
    const reopened = await createStores({ backend, baseDir });
    try {
      expect(await reopened.auditLogStore.findProcessedSessionFingerprints("p1", queries)).toEqual([saved, rejected, duplicate]);
      expect(await reopened.auditLogStore.findProcessedSessionFingerprints("p2", queries)).toEqual([foreign]);
    } finally {
      reopened.close?.();
    }
  });

  if (backend === "json") {
    it("recovers a committed disposition after its marker write fails and the store reopens", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "om-session-recovery-"));
      directories.push(baseDir);
      const fingerprint = "f".repeat(64);
      const { auditLogStore } = await createStores({ backend, baseDir });
      await auditLogStore.findProcessedSessionFingerprints("p1", [fingerprint]);
      const markerWrite = vi.spyOn(jsonFile, "writeJsonObject").mockRejectedValueOnce(new Error("Marker write failed"));
      await expect(auditLogStore.append({
        id: "interrupted", projectId: "p1", type: "memory_saved", createdAt: "2026-05-08T00:00:00.000Z",
        details: { sessionFingerprint: fingerprint },
      })).rejects.toThrow("Marker write failed");
      markerWrite.mockRestore();
      const reopened = await createStores({ backend, baseDir });
      expect(await reopened.auditLogStore.findProcessedSessionFingerprints("p1", [fingerprint])).toEqual([fingerprint]);
      expect(await reopened.auditLogStore.list("p1")).toHaveLength(1);
    });

    it("backfills once from existing audit records and never rereads history for indexed lookups", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "om-session-index-"));
      directories.push(baseDir);
      const fingerprint = "f".repeat(64);
      await writeFile(join(baseDir, "audit-log.json"), JSON.stringify([{
        id: "legacy", projectId: "p1", type: "candidate_rejected",
        createdAt: "2026-05-08T00:00:00.000Z", details: { sessionFingerprint: fingerprint, rejectedByUser: true },
      }]));
      const { auditLogStore } = await createStores({ backend, baseDir });
      expect(await auditLogStore.findProcessedSessionFingerprints("p1", [fingerprint])).toEqual([fingerprint]);
      await writeFile(join(baseDir, "audit-log.json"), "unreadable audit history");
      expect(await auditLogStore.findProcessedSessionFingerprints("p1", [fingerprint])).toEqual([fingerprint]);
    });
  }
});
