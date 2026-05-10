import { describe, it, expect } from "vitest";
import { MemoryUpdateService, OpenMembrainError, PolicyEngine, sensitivityRank } from "@openmembrain/core";
import type { AuditEvent, MemoryEntry, MemoryStore, AuditLogStore } from "@openmembrain/core";
import { entry } from "./helpers";

describe("SENSITIVITY_DOWNGRADE error code", () => {
  it("can be used to construct an OpenMembrainError", () => {
    const error = new OpenMembrainError({
      code: "SENSITIVITY_DOWNGRADE",
      message: "Cannot lower sensitivity."
    });
    expect(error.code).toBe("SENSITIVITY_DOWNGRADE");
  });
});

describe("memory_updated audit event type", () => {
  it("is a valid AuditEvent type", () => {
    const event: AuditEvent = {
      id: "audit_test",
      projectId: "project-a",
      type: "memory_updated",
      createdAt: "2026-05-10T00:00:00.000Z"
    };
    expect(event.type).toBe("memory_updated");
  });
});

describe("sensitivityRank", () => {
  it("returns ascending numeric ranks", () => {
    expect(sensitivityRank("public")).toBeLessThan(sensitivityRank("internal"));
    expect(sensitivityRank("internal")).toBeLessThan(sensitivityRank("confidential"));
    expect(sensitivityRank("confidential")).toBeLessThan(sensitivityRank("secret"));
  });
});

function createStubs(existing?: MemoryEntry) {
  const saved: MemoryEntry[] = [];
  const audited: AuditEvent[] = [];
  const memoryStore: MemoryStore = {
    findById: async (_pid: string, _mid: string) => existing,
    save: async (e: MemoryEntry) => { saved.push(e); return e; },
    list: async () => [],
    supersede: async () => existing!,
    search: async () => []
  };
  const auditLogStore: AuditLogStore = {
    append: async (evt: AuditEvent) => { audited.push(evt); },
    list: async () => audited
  };
  return { memoryStore, auditLogStore, saved, audited };
}

describe("MemoryUpdateService", () => {
  it("updates content and returns updated entry", async () => {
    const existing = entry({ id: "mem_1", content: "old content", sensitivity: "public" });
    const { memoryStore, auditLogStore, saved } = createStubs(existing);
    const service = new MemoryUpdateService({ memoryStore, auditLogStore });

    const result = await service.update("project-a", "mem_1", { content: "new content" });

    expect(result.content).toBe("new content");
    expect(result.id).toBe("mem_1");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.content).toBe("new content");
  });

  it("updates type, scope, and tags", async () => {
    const existing = entry();
    const { memoryStore, auditLogStore, saved } = createStubs(existing);
    const service = new MemoryUpdateService({ memoryStore, auditLogStore });

    const result = await service.update("project-a", "mem_1", {
      type: "known_gotcha",
      scope: "backend",
      tags: ["important"]
    });

    expect(result.type).toBe("known_gotcha");
    expect(result.scope).toBe("backend");
    expect(result.tags).toEqual(["important"]);
  });

  it("appends memory_updated audit event with previous values", async () => {
    const existing = entry({ content: "old", tags: ["a"] });
    const { memoryStore, auditLogStore, audited } = createStubs(existing);
    const service = new MemoryUpdateService({ memoryStore, auditLogStore });

    await service.update("project-a", "mem_1", { content: "new", tags: ["b"] });

    expect(audited).toHaveLength(1);
    expect(audited[0]!.type).toBe("memory_updated");
    expect(audited[0]!.details).toMatchObject({
      previousContent: "old",
      previousTags: ["a"]
    });
  });

  it("sets updatedAt to current time", async () => {
    const existing = entry({ updatedAt: "2020-01-01T00:00:00.000Z" });
    const { memoryStore, auditLogStore, saved } = createStubs(existing);
    const service = new MemoryUpdateService({ memoryStore, auditLogStore });

    await service.update("project-a", "mem_1", { content: "updated" });

    expect(saved[0]!.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("throws MEMORY_NOT_FOUND for non-existent memory", async () => {
    const { memoryStore, auditLogStore } = createStubs(undefined);
    const service = new MemoryUpdateService({ memoryStore, auditLogStore });

    await expect(service.update("project-a", "mem_missing", { content: "x" }))
      .rejects.toThrow("was not found");
  });

  it("throws MEMORY_ALREADY_SUPERSEDED for superseded memory", async () => {
    const superseded = entry({ status: "superseded" });
    const { memoryStore, auditLogStore } = createStubs(superseded);
    const service = new MemoryUpdateService({ memoryStore, auditLogStore });

    await expect(service.update("project-a", "mem_1", { content: "x" }))
      .rejects.toThrow("cannot be updated");
  });

  it("rejects content containing secrets", async () => {
    const existing = entry();
    const { memoryStore, auditLogStore } = createStubs(existing);
    const service = new MemoryUpdateService({ memoryStore, auditLogStore });

    await expect(service.update("project-a", "mem_1", { content: "key = AKIA1234567890ABCDEF" }))
      .rejects.toThrow("contains secrets");
  });

  it("rejects content containing redacted markers", async () => {
    const existing = entry();
    const { memoryStore, auditLogStore } = createStubs(existing);
    const service = new MemoryUpdateService({ memoryStore, auditLogStore });

    await expect(service.update("project-a", "mem_1", { content: "uses [REDACTED:api_key] for auth" }))
      .rejects.toThrow("contains secrets");
  });

  it("upgrades sensitivity when policy detects higher level", async () => {
    const existing = entry({ sensitivity: "public", content: "old" });
    const { memoryStore, auditLogStore, saved } = createStubs(existing);
    const policyEngine = {
      evaluate: () => ({ allowed: true, sensitivity: "confidential" as const, violations: [] })
    } as unknown as PolicyEngine;
    const service = new MemoryUpdateService({ memoryStore, auditLogStore, policyEngine });

    const result = await service.update("project-a", "mem_1", { content: "new sensitive content" });

    expect(result.sensitivity).toBe("confidential");
    expect(saved[0]!.sensitivity).toBe("confidential");
  });

  it("rejects policy violations", async () => {
    const existing = entry();
    const { memoryStore, auditLogStore } = createStubs(existing);
    const policyEngine = {
      evaluate: () => ({ allowed: false, sensitivity: "internal" as const, violations: ["Content too large"] })
    } as unknown as PolicyEngine;
    const service = new MemoryUpdateService({ memoryStore, auditLogStore, policyEngine });

    await expect(service.update("project-a", "mem_1", { content: "x".repeat(2000) }))
      .rejects.toThrow("violates policy");
  });

  it("does not run policy check when content is unchanged", async () => {
    const existing = entry();
    const { memoryStore, auditLogStore, saved } = createStubs(existing);
    let policyCalled = false;
    const policyEngine = {
      evaluate: () => { policyCalled = true; return { allowed: false, sensitivity: "internal" as const, violations: ["fail"] }; }
    } as unknown as PolicyEngine;
    const service = new MemoryUpdateService({ memoryStore, auditLogStore, policyEngine });

    const result = await service.update("project-a", "mem_1", { tags: ["new-tag"] });

    expect(policyCalled).toBe(false);
    expect(result.tags).toEqual(["new-tag"]);
    expect(saved).toHaveLength(1);
  });

  it("rejects tags containing secrets", async () => {
    const existing = entry();
    const { memoryStore, auditLogStore } = createStubs(existing);
    const service = new MemoryUpdateService({ memoryStore, auditLogStore });

    await expect(service.update("project-a", "mem_1", { tags: ["AKIA1234567890ABCDEF"] }))
      .rejects.toThrow("tags contain secrets");
  });

  it("rejects tags containing redacted markers", async () => {
    const existing = entry();
    const { memoryStore, auditLogStore } = createStubs(existing);
    const service = new MemoryUpdateService({ memoryStore, auditLogStore });

    await expect(service.update("project-a", "mem_1", { tags: ["[REDACTED:api_key]"] }))
      .rejects.toThrow("tags contain secrets");
  });
});
