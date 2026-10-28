import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelationshipService, systemRelationshipId } from "@openmembrane/core";
import type { StorageBackend, StoreSet } from "@openmembrane/storage";
import { createStores } from "@openmembrane/storage";
import { candidate, entry } from "./helpers";

describe.each<StorageBackend>(["json", "sqlite"])("RelationshipService (%s)", (backend) => {
  let dir: string;
  let stores: StoreSet;
  let service: RelationshipService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "openmembrane-rel-"));
    stores = await createStores({ backend, baseDir: dir });
    service = new RelationshipService(stores);
    await stores.memoryStore.save(entry({ id: "mem_1" }));
    await stores.memoryStore.save(entry({ id: "mem_2" }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    stores.close?.();
    await rm(dir, { recursive: true, force: true });
  });

  const link = (overrides: Record<string, unknown> = {}) => ({
    source: { kind: "memory" as const, id: "mem_1" },
    target: { kind: "memory" as const, id: "mem_2" },
    type: "supports" as const,
    rationale: "Both describe the build.",
    ...overrides,
  });

  it("persists manual relationships and audits creation", async () => {
    const created = await service.createManual("project-a", link());
    expect(created).toMatchObject({ origin: "manual", status: "active", confidence: 1, type: "supports" });
    expect(await service.list("project-a")).toEqual([created]);
    expect(await service.list("project-b")).toEqual([]);
    const audit = await stores.auditLogStore.list("project-a");
    expect(audit.map((event) => event.type)).toEqual(["relationship_created"]);
  });

  it.each(["related_to", "supports", "depends_on", "conflicts_with", "duplicate_of", "supersedes", "derived_from", "tagged_with"] as const)(
    "supports %s",
    async (type) => {
      expect((await service.createManual("project-a", link({ type }))).type).toBe(type);
    },
  );

  it("rejects secrets, invalid input, self links, and unknown entities", async () => {
    await expect(service.createManual("project-a", link({ rationale: "token = abcdefgh12345678" }))).rejects.toMatchObject({ code: "SECRET_CANDIDATE" });
    await expect(service.createManual("project-a", link({ target: { kind: "tag", id: "ghp_abcdefghijklmnopqrstuvwxyz" } }))).rejects.toMatchObject({ code: "SECRET_CANDIDATE" });
    await expect(service.createManual("project-a", link({ confidence: 2 }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.createManual("project-a", link({ type: "nope" }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.createManual("project-a", link({ target: { kind: "memory", id: "mem_1" } }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.createManual("project-a", link({ target: { kind: "memory", id: "missing" } }))).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
    await stores.pendingCandidateStore.save(candidate({ id: "cand_s", sensitivity: "secret" }));
    await expect(service.createManual("project-a", link({ target: { kind: "candidate", id: "cand_s" } }))).rejects.toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
    expect(await service.listEvidence("project-a")).toEqual([]);
  });

  it("projects duplicate and conflict metadata as derived and skips secrets", async () => {
    await stores.pendingCandidateStore.save(candidate({ id: "cand_1", duplicateOf: "mem_1", conflictWith: ["mem_2"] }));
    await stores.pendingCandidateStore.save(candidate({ id: "cand_2", sensitivity: "secret", duplicateOf: "mem_1" }));

    const derived = await service.syncDerived("project-a");
    expect(derived.every((item) => item.origin === "derived" && item.status === "active")).toBe(true);
    expect(derived.map((item) => [item.source.id, item.type, item.target.id]).sort()).toEqual([
      ["cand_1", "conflicts_with", "mem_2"],
      ["cand_1", "duplicate_of", "mem_1"],
    ]);

    const again = await service.syncDerived("project-a");
    expect(again.map((item) => item.id).sort()).toEqual(derived.map((item) => item.id).sort());
    expect(await service.listEvidence("project-a")).toHaveLength(2);
  });

  it("projects duplicates recorded only in the rejection audit log", async () => {
    await stores.auditLogStore.append({
      id: "audit_dup",
      projectId: "project-a",
      type: "candidate_rejected",
      entityId: "cand_gone",
      createdAt: "2026-05-08T00:00:00.000Z",
      details: { reason: "Duplicate memory already exists.", duplicateOf: "mem_1" },
    });
    await stores.auditLogStore.append({ id: "audit_other", projectId: "project-a", type: "candidate_rejected", entityId: "cand_x", createdAt: "2026-05-08T00:00:00.000Z", details: { reason: "Noise." } });
    const derived = await service.syncDerived("project-a");
    expect(derived.map((item) => [item.source.id, item.type, item.target.id])).toEqual([["cand_gone", "duplicate_of", "mem_1"]]);
  });

  it("persists inferred relationships with rationale and confidence, and lets manual removal override them", async () => {
    await stores.memoryStore.save(entry({ id: "mem_3", content: "Deploy with blue-green releases.", scope: "deployment" }));
    await stores.memoryStore.supersede("project-a", "mem_3");
    await stores.auditLogStore.append({
      id: "audit_sup", projectId: "project-a", type: "memory_superseded", entityId: "mem_3",
      createdAt: "2026-05-08T00:00:00.000Z", details: { supersededBy: "cand_2" },
    });
    await stores.memoryStore.save(entry({ id: "mem_2_new", content: "Deploy with canary releases.", scope: "deployment" }));
    await stores.auditLogStore.append({
      id: "audit_sup2", projectId: "project-a", type: "memory_superseded", entityId: "mem_3",
      createdAt: "2026-05-08T00:00:00.000Z", details: { supersededBy: "mem_2_new" },
    });
    await stores.pendingCandidateStore.save(candidate({ id: "cand_s", sensitivity: "secret" }));

    const inferred = await service.syncInferred("project-a");
    const summary = inferred.map((item) => [item.source.id, item.type, item.target.id]);
    expect(summary).toEqual(expect.arrayContaining([["mem_1", "related_to", "mem_2"], ["mem_2_new", "supersedes", "mem_3"]]));
    expect(summary.flat()).not.toContain("cand_s");
    expect(inferred.every((item) => item.origin === "inferred" && item.rationale.length > 0 && item.confidence > 0)).toBe(true);
    const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id);
    expect([...(await service.listEvidence("project-a"))].sort(byId)).toEqual([...inferred].sort(byId));

    const again = await service.syncInferred("project-a");
    expect(again).toEqual(inferred);

    const related = inferred.find((item) => item.type === "related_to")!;
    await service.remove("project-a", related.id);
    await service.syncInferred("project-a");
    expect((await service.list("project-a")).some((item) => item.id === related.id)).toBe(false);
    expect((await service.listEvidence("project-a")).find((item) => item.id === related.id)).toMatchObject({ status: "active", origin: "inferred" });
  });

  it("infers supersession recorded by the public supersede operation", async () => {
    await stores.memoryStore.save(entry({ id: "mem_old", content: "Old deployment rule.", scope: "deployment" }));
    await stores.memoryStore.supersede("project-a", "mem_old", "mem_2");
    await stores.auditLogStore.append({
      id: "audit_pub", projectId: "project-a", type: "memory_superseded", entityId: "mem_old",
      createdAt: "2026-05-08T00:00:00.000Z", details: { reason: "Superseded via tool.", replacementId: "mem_2" },
    });
    const inferred = await service.syncInferred("project-a");
    expect(inferred.map((item) => [item.source.id, item.type, item.target.id])).toContainEqual(["mem_2", "supersedes", "mem_old"]);
  });

  it("infers supersession from stored metadata without an audit event", async () => {
    await stores.memoryStore.save(entry({ id: "mem_old", content: "Old deployment rule.", scope: "deployment" }));
    await stores.memoryStore.supersede("project-a", "mem_old", "mem_2");
    const inferred = await service.syncInferred("project-a");
    expect(inferred.map((item) => [item.source.id, item.type, item.target.id])).toContainEqual(["mem_2", "supersedes", "mem_old"]);
  });

  it("validates every inferred draft before writing any", async () => {
    await expect(service.replaceSystemRelationships("project-a", "inferred", [
      { source: { kind: "memory", id: "mem_1" }, target: { kind: "memory", id: "mem_2" }, type: "related_to", confidence: 0.5, rationale: "Valid." },
      { source: { kind: "memory", id: "mem_2" }, target: { kind: "memory", id: "mem_1" }, type: "related_to", confidence: 0.5, rationale: "token = abcdefgh12345678" },
    ])).rejects.toMatchObject({ code: "SECRET_CANDIDATE" });
    expect(await service.listEvidence("project-a")).toEqual([]);
  });

  it("keeps concurrent manual creation to a single record", async () => {
    const [first, second] = await Promise.all([service.createManual("project-a", link()), service.createManual("project-a", link())]);
    expect(first.id).toBe(second.id);
    expect(await service.list("project-a")).toHaveLength(1);
    await service.remove("project-a", first.id);
    expect(await service.list("project-a")).toEqual([]);
  });
  it("skips system relationships that reference secret candidates", async () => {
    await stores.pendingCandidateStore.save(candidate({ id: "cand_s", sensitivity: "secret" }));
    const saved = await service.replaceSystemRelationships("project-a", "inferred", [
      { source: { kind: "candidate", id: "cand_s" }, target: { kind: "memory", id: "mem_1" }, type: "related_to", confidence: 0.8, rationale: "Shared tags." },
    ]);
    expect(saved).toEqual([]);
    expect(await service.listEvidence("project-a")).toEqual([]);
  });
  it("restores audit-only duplicates after removal", async () => {
    await stores.auditLogStore.append({
      id: "audit_dup", projectId: "project-a", type: "candidate_rejected", entityId: "cand_gone",
      createdAt: "2026-05-08T00:00:00.000Z", details: { duplicateOf: "mem_1" },
    });
    const [derived] = await service.syncDerived("project-a");
    await service.remove("project-a", derived!.id);
    expect(await service.list("project-a")).toEqual([]);
    const restored = await service.createManual("project-a", {
      source: { kind: "candidate", id: "cand_gone" }, target: { kind: "memory", id: "mem_1" }, type: "duplicate_of", rationale: "Confirmed.",
    });
    expect(restored.status).toBe("active");
    await expect(service.createManual("project-a", { ...link(), source: { kind: "candidate", id: "cand_unknown" } })).rejects.toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
  });

  it("keeps duplicates of pending candidates as candidate references", async () => {
    await stores.pendingCandidateStore.save(candidate({ id: "cand_old" }));
    await stores.auditLogStore.append({
      id: "audit_dup", projectId: "project-a", type: "candidate_rejected", entityId: "cand_new",
      createdAt: "2026-05-08T00:00:00.000Z", details: { duplicateOf: "cand_old" },
    });
    const derived = await service.syncDerived("project-a");
    expect(derived.map((item) => item.target)).toEqual([{ kind: "candidate", id: "cand_old" }]);
  });

  it("preserves audit-backed duplicate targets after they leave the pending queue", async () => {
    await stores.auditLogStore.append({
      id: "audit_dup", projectId: "project-a", type: "candidate_rejected", entityId: "cand_new",
      createdAt: "2026-05-08T00:00:00.000Z", details: { duplicateOf: "cand_old" },
    });
    await stores.auditLogStore.append({
      id: "audit_rejected", projectId: "project-a", type: "candidate_rejected", entityId: "cand_old",
      createdAt: "2026-05-08T00:00:00.000Z", details: { rejectedByUser: true },
    });
    const derived = await service.syncDerived("project-a");
    expect(derived).toHaveLength(1);
    expect(derived[0]?.target).toEqual({ kind: "candidate", id: "cand_old" });
    const manual = await service.createManual("project-a", {
      ...link(), source: { kind: "candidate", id: "cand_old" },
    });
    expect(manual.origin).toBe("manual");
  });

  it("does not use removed relationship evidence to authorize a purged candidate", async () => {
    await stores.pendingCandidateStore.save(candidate());
    const created = await service.createManual("project-a", {
      ...link(), source: { kind: "candidate", id: "cand_1" },
    });
    await service.remove("project-a", created.id);
    await stores.pendingCandidateStore.remove("project-a", "cand_1");
    await expect(service.createManual("project-a", {
      ...link(), source: { kind: "candidate", id: "cand_1" },
    })).rejects.toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
    expect(await service.replaceSystemRelationships("project-a", "inferred", [{
      ...link(), confidence: 0.8, source: { kind: "candidate", id: "cand_1" },
    }])).toEqual([]);
    expect(await service.listEvidence("project-a")).toHaveLength(1);
  });

  it.each(["audit_event", "diagnostic"] as const)("validates %s endpoints against their project stores", async (kind) => {
    if (kind === "audit_event") {
      for (const projectId of ["project-a", "project-b"]) {
        await stores.auditLogStore.append({
          id: `audit_${projectId}`, projectId, type: "memory_saved", createdAt: "2026-05-08T00:00:00.000Z",
        });
      }
    } else {
      for (const projectId of ["project-a", "project-b"]) {
        await stores.diagnosticsLogStore.append({
          id: `diag_${projectId}`, projectId, severity: "info", code: "TEST",
          message: "Test diagnostic.", createdAt: "2026-05-08T00:00:00.000Z",
        });
      }
    }
    const prefix = kind === "audit_event" ? "audit" : "diag";
    for (const endpoint of ["source", "target"] as const) {
      for (const id of ["missing", `${prefix}_project-b`]) {
        await expect(service.createManual("project-a", {
          ...link(), [endpoint]: { kind, id },
        })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect(await service.replaceSystemRelationships("project-a", "inferred", [{
          ...link(), confidence: 0.8, [endpoint]: { kind, id },
        }])).toEqual([]);
      }
    }
    const source = { kind, id: `${prefix}_project-a` };
    const manual = await service.createManual("project-a", { ...link(), source });
    expect(manual.source).toEqual(source);
    expect(await service.replaceSystemRelationships("project-a", "inferred", [{
      ...link(), confidence: 0.8, source,
    }])).toHaveLength(1);
  });

  it("checks diagnostics beyond the default recent-event limit", async () => {
    for (let index = 0; index < 101; index++) {
      await stores.diagnosticsLogStore.append({
        id: `diag_${index}`, projectId: "project-a", severity: "info", code: "TEST",
        message: "Test diagnostic.", createdAt: new Date(index * 1000).toISOString(),
      });
    }
    expect((await stores.diagnosticsLogStore.list("project-a")).some((event) => event.id === "diag_0")).toBe(false);
    const created = await service.createManual("project-a", { ...link(), source: { kind: "diagnostic", id: "diag_0" } });
    expect(created.source.id).toBe("diag_0");
  });

  it("reads each project snapshot once and resolves each distinct memory once during refresh", async () => {
    await stores.memoryStore.supersede("project-a", "mem_1", "mem_2");
    for (let index = 0; index < 5; index++) {
      await stores.auditLogStore.append({
        id: `audit_dup_${index}`, projectId: "project-a", type: "candidate_rejected", entityId: `cand_${index}`,
        createdAt: "2026-05-08T00:00:00.000Z", details: { duplicateOf: "mem_1" },
      });
    }
    const pending = vi.spyOn(stores.pendingCandidateStore, "list");
    const audit = vi.spyOn(stores.auditLogStore, "list");
    const evidence = vi.spyOn(stores.relationshipStore, "list");
    const diagnostics = vi.spyOn(stores.diagnosticsLogStore, "list");
    const memory = vi.spyOn(stores.memoryStore, "findById");
    expect(await service.syncDerived("project-a")).toHaveLength(5);
    for (const spy of [pending, audit, evidence, diagnostics, memory]) expect(spy).toHaveBeenCalledTimes(1);
    expect(memory).toHaveBeenCalledWith("project-a", "mem_1");
  });

  it("keeps distinct relationship types independent until explicitly removed", async () => {
    const [inferred] = await service.replaceSystemRelationships("project-a", "inferred", [{
      ...link(), type: "related_to", confidence: 0.8,
    }]);
    const manual = await service.createManual("project-a", link({ type: "conflicts_with" }));
    expect(await service.list("project-a")).toHaveLength(2);
    await service.remove("project-a", inferred!.id, "Replaced with a more specific relationship.");
    expect(await service.list("project-a")).toEqual([manual]);
    expect((await service.listEvidence("project-a")).find((item) => item.id === inferred!.id)?.status).toBe("active");
  });

  it("excludes candidates whose content contains a secret despite a non-secret label", async () => {
    await stores.pendingCandidateStore.save(candidate({ id: "cand_leak", content: "Use key AKIAABCDEFGHIJKLMNOP for deploys.", duplicateOf: "mem_1" }));
    await stores.auditLogStore.append({
      id: "audit_leak", projectId: "project-a", type: "candidate_rejected", entityId: "cand_leak",
      createdAt: "2026-05-08T00:00:00.000Z", details: { duplicateOf: "mem_1" },
    });
    await expect(service.createManual("project-a", { ...link(), source: { kind: "candidate", id: "cand_leak" } })).rejects.toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
    expect(await service.syncDerived("project-a")).toEqual([]);
    expect(await service.replaceSystemRelationships("project-a", "inferred", [
      { source: { kind: "candidate", id: "cand_leak" }, target: { kind: "memory", id: "mem_1" }, type: "related_to", confidence: 0.8, rationale: "Shared tags." },
    ])).toEqual([]);
  });
  it("marks stale derived relationships removed without deleting them", async () => {
    await stores.pendingCandidateStore.save(candidate({ id: "cand_1", duplicateOf: "mem_1" }));
    await service.syncDerived("project-a");
    await stores.pendingCandidateStore.remove("project-a", "cand_1");
    await service.syncDerived("project-a");
    expect(await service.list("project-a")).toEqual([]);
    expect((await service.listEvidence("project-a"))[0]).toMatchObject({ status: "removed" });
  });

  it("lets a manual relationship override inference while keeping evidence", async () => {
    await service.replaceSystemRelationships("project-a", "inferred", [
      { ...link({ type: "conflicts_with" }), confidence: 0.6, rationale: "Shared tags." },
    ]);
    const manual = await service.createManual("project-a", link({ type: "conflicts_with", rationale: "Confirmed." }));

    expect(await service.list("project-a")).toEqual([manual]);
    const evidence = await service.listEvidence("project-a");
    expect(evidence.map((item) => item.origin).sort()).toEqual(["inferred", "manual"]);
    expect(evidence.find((item) => item.origin === "inferred")).toMatchObject({ status: "active", rationale: "Shared tags." });
    const [event] = await stores.auditLogStore.list("project-a");
    expect(event?.details?.overriddenRelationshipIds).toHaveLength(1);
  });

  it("overrides derived relationships with a manual removal and audits it", async () => {
    await stores.pendingCandidateStore.save(candidate({ id: "cand_1", duplicateOf: "mem_1" }));
    const [derived] = await service.syncDerived("project-a");
    const removal = await service.remove("project-a", derived!.id, "Not really a duplicate.");

    expect(removal).toMatchObject({ origin: "manual", status: "removed" });
    expect(await service.list("project-a")).toEqual([]);
    await service.syncDerived("project-a");
    expect(await service.list("project-a")).toEqual([]);
    expect((await service.listEvidence("project-a")).find((item) => item.id === derived!.id)).toMatchObject({ origin: "derived", status: "active" });
    expect((await stores.auditLogStore.list("project-a")).map((event) => event.type)).toEqual(["relationship_removed"]);
  });

  it("removes and restores manual relationships", async () => {
    const created = await service.createManual("project-a", link());
    const removed = await service.remove("project-a", created.id);
    expect(removed.id).toBe(created.id);
    expect(await service.list("project-a")).toEqual([]);
    const restored = await service.createManual("project-a", link());
    expect(restored).toMatchObject({ id: created.id, status: "active", createdAt: created.createdAt });
    expect(restored.removedAt).toBeUndefined();
    expect(await service.list("project-a")).toHaveLength(1);
    await expect(service.remove("project-a", "missing")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("uses deterministic system ids per origin and keeps projects isolated", async () => {
    const draft = { ...link(), confidence: 0.7, rationale: "Shared session." };
    expect(systemRelationshipId("inferred", draft)).not.toBe(systemRelationshipId("derived", draft));
    await service.replaceSystemRelationships("project-a", "inferred", [draft]);
    await stores.memoryStore.save(entry({ id: "mem_1", projectId: "project-b" }));
    await stores.memoryStore.save(entry({ id: "mem_2", projectId: "project-b" }));
    await service.replaceSystemRelationships("project-b", "inferred", [draft]);
    expect(await service.list("project-a")).toHaveLength(1);
    expect(await service.list("project-b")).toHaveLength(1);
  });
});
