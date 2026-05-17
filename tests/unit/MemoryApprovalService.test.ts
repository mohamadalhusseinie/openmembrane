import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryApprovalService, OpenMembrainError } from "@openmembrain/core";
import { JsonAuditLogStore, JsonMemoryStore, JsonPendingCandidateStore } from "@openmembrain/storage";
import { candidate, entry } from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService() {
  const dir = await mkdtemp(join(tmpdir(), "openmembrain-approval-test-"));
  tempDirs.push(dir);
  const memoryStore = new JsonMemoryStore(dir);
  const pendingCandidateStore = new JsonPendingCandidateStore(dir);
  const auditLogStore = new JsonAuditLogStore(dir);
  const service = new MemoryApprovalService({ memoryStore, pendingCandidateStore, auditLogStore });
  return { service, memoryStore, pendingCandidateStore, auditLogStore };
}

describe("MemoryApprovalService", () => {
  describe("approve", () => {
    it("throws CANDIDATE_NOT_FOUND when candidate does not exist", async () => {
      const { service } = await createService();
      await expect(service.approve("project-a", "cand_nonexistent")).rejects.toThrow(OpenMembrainError);
      try {
        await service.approve("project-a", "cand_nonexistent");
      } catch (error) {
        expect((error as OpenMembrainError).code).toBe("CANDIDATE_NOT_FOUND");
      }
    });

    it("throws SECRET_CANDIDATE when candidate has secret sensitivity", async () => {
      const { service, pendingCandidateStore } = await createService();
      await pendingCandidateStore.save(candidate({ id: "cand_1", sensitivity: "secret" }));
      await expect(service.approve("project-a", "cand_1")).rejects.toThrow(OpenMembrainError);
      try {
        await service.approve("project-a", "cand_1");
      } catch (error) {
        expect((error as OpenMembrainError).code).toBe("SECRET_CANDIDATE");
      }
    });

    it("throws SECRET_CANDIDATE when candidate content contains a secret", async () => {
      const { service, pendingCandidateStore } = await createService();
      await pendingCandidateStore.save(
        candidate({ id: "cand_1", content: "Key: AKIAIOSFODNN7EXAMPLE", sensitivity: "internal" })
      );
      await expect(service.approve("project-a", "cand_1")).rejects.toThrow(OpenMembrainError);
      try {
        await service.approve("project-a", "cand_1");
      } catch (error) {
        expect((error as OpenMembrainError).code).toBe("SECRET_CANDIDATE");
      }
    });

    it("returns existing memory when duplicate is detected on approve", async () => {
      const { service, memoryStore, pendingCandidateStore } = await createService();
      const existingMemory = entry({ id: "mem_existing", content: "Use standalone components." });
      await memoryStore.save(existingMemory);
      await pendingCandidateStore.save(
        candidate({ id: "cand_1", content: "Use standalone components." })
      );
      const result = await service.approve("project-a", "cand_1");
      expect(result.id).toBe("mem_existing");
      await expect(pendingCandidateStore.findById("project-a", "cand_1")).resolves.toBeUndefined();
    });

    it("saves memory and logs audit event on successful approve", async () => {
      const { service, memoryStore, pendingCandidateStore, auditLogStore } = await createService();
      await pendingCandidateStore.save(
        candidate({ id: "cand_1", content: "Angular uses OnPush detection." })
      );
      const result = await service.approve("project-a", "cand_1");
      expect(result.id).toMatch(/^mem_/);
      expect(result.status).toBe("active");
      const memories = await memoryStore.list("project-a");
      expect(memories).toHaveLength(1);
      await expect(pendingCandidateStore.findById("project-a", "cand_1")).resolves.toBeUndefined();
      const events = await auditLogStore.list("project-a");
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("memory_saved");
      expect(events[0]!.details?.approvedManually).toBe(true);
    });

    it("supersedes conflicting memories when candidate has conflictWith", async () => {
      const { service, memoryStore, pendingCandidateStore, auditLogStore } = await createService();
      const conflicting = entry({ id: "mem_old", content: "Use React for frontend." });
      await memoryStore.save(conflicting);
      await pendingCandidateStore.save(
        candidate({ id: "cand_1", content: "Use Angular for frontend.", conflictWith: ["mem_old"] })
      );

      const result = await service.approve("project-a", "cand_1");
      expect(result.id).toMatch(/^mem_/);

      const memories = await memoryStore.list("project-a");
      expect(memories).toHaveLength(1);
      expect(memories[0]!.id).toBe(result.id);

      const events = await auditLogStore.list("project-a");
      const supersededEvents = events.filter((e) => e.type === "memory_superseded");
      expect(supersededEvents).toHaveLength(1);
      expect(supersededEvents[0]!.entityId).toBe("mem_old");
      expect(supersededEvents[0]!.details?.supersededBy).toBe(result.id);
    });

    it("does not fail when conflicting memory is already superseded", async () => {
      const { service, memoryStore, pendingCandidateStore } = await createService();
      const conflicting = entry({ id: "mem_old", content: "Use React for frontend." });
      await memoryStore.save(conflicting);
      await memoryStore.supersede("project-a", "mem_old");
      await pendingCandidateStore.save(
        candidate({ id: "cand_1", content: "Use Angular for frontend.", conflictWith: ["mem_old"] })
      );

      const result = await service.approve("project-a", "cand_1");
      expect(result.id).toMatch(/^mem_/);
    });

    it("does not supersede anything when candidate has no conflictWith", async () => {
      const { service, memoryStore, pendingCandidateStore, auditLogStore } = await createService();
      await memoryStore.save(entry({ id: "mem_existing", content: "Unrelated memory." }));
      await pendingCandidateStore.save(
        candidate({ id: "cand_1", content: "Angular uses OnPush detection." })
      );

      await service.approve("project-a", "cand_1");

      const memories = await memoryStore.list("project-a");
      expect(memories).toHaveLength(2);

      const events = await auditLogStore.list("project-a");
      const supersededEvents = events.filter((e) => e.type === "memory_superseded");
      expect(supersededEvents).toHaveLength(0);
    });
  });

  describe("reject", () => {
    it("throws CANDIDATE_NOT_FOUND when candidate does not exist", async () => {
      const { service } = await createService();
      await expect(service.reject("project-a", "cand_nonexistent")).rejects.toThrow(OpenMembrainError);
      try {
        await service.reject("project-a", "cand_nonexistent");
      } catch (error) {
        expect((error as OpenMembrainError).code).toBe("CANDIDATE_NOT_FOUND");
      }
    });

    it("rejects with custom reason", async () => {
      const { service, pendingCandidateStore, auditLogStore } = await createService();
      await pendingCandidateStore.save(candidate({ id: "cand_1" }));
      await service.reject("project-a", "cand_1", "Not relevant to this project.");
      await expect(pendingCandidateStore.findById("project-a", "cand_1")).resolves.toBeUndefined();
      const events = await auditLogStore.list("project-a");
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("candidate_rejected");
      expect(events[0]!.details?.reason).toBe("Not relevant to this project.");
    });

    it("rejects with default reason when none provided", async () => {
      const { service, pendingCandidateStore, auditLogStore } = await createService();
      await pendingCandidateStore.save(candidate({ id: "cand_1" }));
      await service.reject("project-a", "cand_1");
      const events = await auditLogStore.list("project-a");
      expect(events[0]!.details?.reason).toBe("Rejected by user.");
    });
  });

  describe("approveAll", () => {
    it("approves multiple pending candidates", async () => {
      const { service, memoryStore, pendingCandidateStore } = await createService();
      await pendingCandidateStore.save(candidate({ id: "cand_1", content: "Rule one" }));
      await pendingCandidateStore.save(candidate({ id: "cand_2", content: "Rule two" }));

      const result = await service.approveAll("project-a");

      expect(result.projectId).toBe("project-a");
      expect(result.approved).toHaveLength(2);
      expect(result.skipped).toHaveLength(0);

      const memories = await memoryStore.list("project-a");
      expect(memories).toHaveLength(2);
    });

    it("skips secret candidates and approves non-secret ones", async () => {
      const { service, pendingCandidateStore } = await createService();
      await pendingCandidateStore.save(candidate({ id: "cand_normal", content: "Safe rule" }));
      await pendingCandidateStore.save(candidate({ id: "cand_secret", content: "Secret stuff", sensitivity: "secret" }));

      const result = await service.approveAll("project-a");

      expect(result.approved).toHaveLength(1);
      expect(result.approved[0]!.content).toBe("Safe rule");
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.candidateId).toBe("cand_secret");
      expect(result.skipped[0]!.reason).toContain("secret");
    });

    it("returns empty arrays when no pending candidates", async () => {
      const { service } = await createService();

      const result = await service.approveAll("project-a");

      expect(result.projectId).toBe("project-a");
      expect(result.approved).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });
  });

  describe("rejectAll", () => {
    it("rejects all pending candidates", async () => {
      const { service, pendingCandidateStore } = await createService();
      await pendingCandidateStore.save(candidate({ id: "cand_1" }));
      await pendingCandidateStore.save(candidate({ id: "cand_2" }));

      const result = await service.rejectAll("project-a");

      expect(result.projectId).toBe("project-a");
      expect(result.rejectedCount).toBe(2);

      const remaining = await pendingCandidateStore.list("project-a");
      expect(remaining).toHaveLength(0);
    });

    it("passes reason to audit log", async () => {
      const { service, pendingCandidateStore, auditLogStore } = await createService();
      await pendingCandidateStore.save(candidate({ id: "cand_1" }));

      await service.rejectAll("project-a", "Bulk cleanup");

      const events = await auditLogStore.list("project-a");
      const rejection = events.find((e) => e.type === "candidate_rejected");
      expect(rejection).toBeDefined();
      expect(rejection!.details).toHaveProperty("reason", "Bulk cleanup");
    });

    it("returns rejectedCount 0 when no pending candidates", async () => {
      const { service } = await createService();

      const result = await service.rejectAll("project-a");

      expect(result.projectId).toBe("project-a");
      expect(result.rejectedCount).toBe(0);
    });
  });
});
