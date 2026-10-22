import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    await service.replaceSystemRelationships("project-b", "inferred", [draft]);
    expect(await service.list("project-a")).toHaveLength(1);
    expect(await service.list("project-b")).toHaveLength(1);
  });
});
