import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CollaborationCheckpoint,
  CollaborationEvent,
  CollaborationProjectConfig,
  CollaborationProposal,
} from "@openmembrane/core";
import { JsonCollaborationStore, JsonMemoryStore } from "@openmembrane/storage";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createBaseDir(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "openmembrane-collaboration-store-test-"));
  tempDirs.push(baseDir);
  return baseDir;
}

function config(projectId: string): CollaborationProjectConfig {
  return {
    projectId,
    mode: "github_team",
    repository: {
      host: "github.com",
      owner: "example",
      name: "project-memory",
      defaultBranch: "main",
    },
    checkoutPath: ".openmembrane/collaboration/repos/project-memory",
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };
}

function proposal(projectId: string): CollaborationProposal {
  return {
    projectId,
    memory: {
      id: "mem_1",
      projectId,
      type: "coding_rule",
      content: "Use strict TypeScript.",
      scope: "tooling",
      confidence: "high",
      sensitivity: "internal",
      reason: "The project typecheck requires strict mode.",
      tags: ["typescript"],
      status: "active",
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    },
    state: "proposed",
    review: {
      provider: "github",
      id: "42",
      url: "https://github.com/example/project-memory/pull/42",
      branch: "openmembrane/memory/mem_1",
    },
    retry: {
      status: "scheduled",
      attempts: 2,
      lastAttemptAt: "2026-09-12T00:01:00.000Z",
      nextAttemptAt: "2026-09-12T00:06:00.000Z",
      failureCode: "GITHUB_UNAVAILABLE",
    },
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:01:00.000Z",
  };
}

function event(projectId: string, id: string): CollaborationEvent {
  return {
    id,
    projectId,
    memoryId: "mem_1",
    type: "review_created",
    createdAt: "2026-09-12T00:01:00.000Z",
  };
}

function checkpoint(projectId: string): CollaborationCheckpoint {
  return {
    projectId,
    defaultBranchCommit: "2dc4b8e",
    syncedAt: "2026-09-12T00:02:00.000Z",
  };
}

describe("JsonCollaborationStore", () => {
  it("round-trips a project configuration without persisting a credential", async () => {
    const baseDir = await createBaseDir();
    const store = new JsonCollaborationStore(baseDir);

    await store.saveProjectConfig(config("project-a"));

    await expect(store.getProjectConfig("project-a")).resolves.toEqual(config("project-a"));
  });

  it("does not persist runtime-only credentials on a project configuration", async () => {
    const baseDir = await createBaseDir();
    const store = new JsonCollaborationStore(baseDir);
    const configuredProject = Object.assign(config("project-a"), { token: "secret-token" });

    await store.saveProjectConfig(configuredProject);

    await expect(readFile(join(baseDir, "collaboration", "projects", "project-a.json"), "utf8")).resolves.not.toContain("secret-token");
  });

  it("keeps proposals out of the active MemoryStore", async () => {
    const baseDir = await createBaseDir();
    const collaborationStore = new JsonCollaborationStore(baseDir);
    const memoryStore = new JsonMemoryStore(baseDir);

    await collaborationStore.saveProposal(proposal("project-a"));

    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toEqual(proposal("project-a"));
    await expect(memoryStore.list("project-a")).resolves.toEqual([]);
  });

  it("isolates project configuration and proposals by project ID", async () => {
    const baseDir = await createBaseDir();
    const store = new JsonCollaborationStore(baseDir);

    await store.saveProjectConfig(config("project-a"));
    await store.saveProjectConfig(config("project-b"));
    await store.saveProposal(proposal("project-a"));
    await store.saveProposal(proposal("project-b"));

    await expect(store.getProjectConfig("project-a")).resolves.toEqual(config("project-a"));
    await expect(store.getProposal("project-a", "mem_1")).resolves.toEqual(proposal("project-a"));
    await expect(store.getProposal("project-b", "mem_1")).resolves.toEqual(proposal("project-b"));
  });

  it("lists only proposals saved for the requested project", async () => {
    const baseDir = await createBaseDir();
    const store = new JsonCollaborationStore(baseDir);
    const firstProposal = proposal("project-a");
    const secondProposal = { ...proposal("project-a"), memory: { ...proposal("project-a").memory, id: "mem_2" } };

    await store.saveProposal(firstProposal);
    await store.saveProposal(secondProposal);
    await store.saveProposal(proposal("project-b"));

    await expect(store.listProposals("project-a")).resolves.toEqual([firstProposal, secondProposal]);
  });

  it("appends lifecycle events instead of replacing existing history", async () => {
    const baseDir = await createBaseDir();
    const store = new JsonCollaborationStore(baseDir);

    await store.appendEvent(event("project-a", "evt_1"));
    await store.appendEvent({ ...event("project-a", "evt_2"), type: "retry_scheduled" });

    await expect(store.listEvents("project-a")).resolves.toEqual([
      event("project-a", "evt_1"),
      { ...event("project-a", "evt_2"), type: "retry_scheduled" },
    ]);
  });

  it("stores synchronization checkpoints per project", async () => {
    const baseDir = await createBaseDir();
    const store = new JsonCollaborationStore(baseDir);

    await store.saveCheckpoint(checkpoint("project-a"));
    await store.saveCheckpoint({ ...checkpoint("project-b"), defaultBranchCommit: "9f3e7c1" });

    await expect(store.getCheckpoint("project-a")).resolves.toEqual(checkpoint("project-a"));
    await expect(store.getCheckpoint("project-b")).resolves.toEqual({
      ...checkpoint("project-b"),
      defaultBranchCommit: "9f3e7c1",
    });
  });
});
