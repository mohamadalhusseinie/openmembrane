import { describe, expect, it } from "vitest";
import type { MemoryEntry, SharedMemoryEntry } from "@openmembrane/core";
import {
  compareFullRebuild,
  createManifestFile,
  createMemoryFile,
  createProjectFile,
  validateMemoryFiles,
  validateManifestFile,
  validateProjectFile,
} from "../../apps/mcp-server/src/collaboration/GitHubRepository";

function memory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "mem_1",
    projectId: "project-a",
    type: "coding_rule",
    content: "Use strict TypeScript.",
    scope: "tooling",
    confidence: "high",
    sensitivity: "internal",
    source: {
      kind: "session",
      sessionId: "session-secret",
      excerpt: "Raw transcript excerpt.",
      transcriptHash: "transcript-secret",
    },
    reason: "The project typecheck requires strict mode.",
    tags: ["typescript"],
    status: "active",
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
    approvedAt: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

function sharedMemory(overrides: Partial<SharedMemoryEntry> = {}): SharedMemoryEntry {
  const { source: _source, ...shared } = memory(overrides);
  return shared;
}

function remoteMemory(entry: SharedMemoryEntry): string {
  return `${JSON.stringify(entry, null, 2)}\n`;
}

describe("GitHubRepository", () => {
  it("serializes only approved retrieval fields into the authoritative memory file", () => {
    const file = createMemoryFile(memory());

    expect(file.path).toBe(".openmembrane/memories/mem_1.json");
    expect(JSON.parse(file.content)).toEqual({
      id: "mem_1",
      projectId: "project-a",
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
      approvedAt: "2026-09-12T00:00:00.000Z",
    });
    expect(file.content).not.toContain("source");
    expect(file.content).not.toContain("session-secret");
    expect(file.content).not.toContain("transcript-secret");
    expect(file.content).not.toContain("Raw transcript excerpt.");
  });

  it("creates a deterministically ordered manifest with SHA-256 memory hashes", () => {
    const first = sharedMemory({ id: "mem_b", content: "Second." });
    const second = sharedMemory({ id: "mem_a", content: "First." });

    const manifest = createManifestFile({
      projectId: "project-a",
      defaultBranch: "main",
      memories: [first, second],
      generatedAt: "2026-09-12T01:00:00.000Z",
    });
    const reorderedManifest = createManifestFile({
      projectId: "project-a",
      defaultBranch: "main",
      memories: [second, first],
      generatedAt: "2026-09-12T01:00:00.000Z",
    });
    const parsed = JSON.parse(manifest.content) as { memories: Array<{ id: string; contentHash: string }> };

    expect(manifest.path).toBe(".openmembrane/manifest.json");
    expect(manifest.content).toBe(reorderedManifest.content);
    expect(parsed.memories).toEqual([
      { id: "mem_a", contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { id: "mem_b", contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    expect(parsed.memories[0]?.contentHash).not.toBe(parsed.memories[1]?.contentHash);
  });

  it("hashes semantically identical entries identically regardless of property insertion order", () => {
    const canonical = sharedMemory();
    const reordered = {
      updatedAt: canonical.updatedAt,
      content: canonical.content,
      projectId: canonical.projectId,
      id: canonical.id,
      tags: canonical.tags,
      type: canonical.type,
      scope: canonical.scope,
      confidence: canonical.confidence,
      sensitivity: canonical.sensitivity,
      reason: canonical.reason,
      status: canonical.status,
      createdAt: canonical.createdAt,
      approvedAt: canonical.approvedAt,
    } as SharedMemoryEntry;

    const canonicalManifest = createManifestFile({
      projectId: "project-a",
      defaultBranch: "main",
      memories: [canonical],
      generatedAt: "2026-09-12T01:00:00.000Z",
    });
    const reorderedManifest = createManifestFile({
      projectId: "project-a",
      defaultBranch: "main",
      memories: [reordered],
      generatedAt: "2026-09-12T01:00:00.000Z",
    });

    expect(JSON.parse(canonicalManifest.content).memories[0].contentHash)
      .toBe(JSON.parse(reorderedManifest.content).memories[0].contentHash);
  });

  it("omits injected runtime fields when serializing an otherwise valid shared entry", () => {
    const injected = Object.assign(sharedMemory(), {
      audit: { id: "audit_1" },
      diagnostic: "internal diagnostic",
      credential: "credential-value",
      sessionId: "session-secret",
      transcriptHash: "transcript-secret",
      excerpt: "Raw transcript excerpt.",
    });

    const file = createMemoryFile(injected);

    expect(JSON.parse(file.content)).toEqual(sharedMemory());
    expect(file.content).not.toContain("audit_1");
    expect(file.content).not.toContain("internal diagnostic");
    expect(file.content).not.toContain("credential-value");
    expect(file.content).not.toContain("session-secret");
    expect(file.content).not.toContain("transcript-secret");
    expect(file.content).not.toContain("Raw transcript excerpt.");
  });

  it("validates repository metadata against its schema and configured project", () => {
    const projectFile = createProjectFile({ projectId: "project-a", defaultBranch: "main" });

    expect(validateProjectFile(projectFile.content, "project-a")).toMatchObject({
      kind: "valid",
      value: { schemaVersion: 1, projectId: "project-a", defaultBranch: "main" },
    });
    expect(validateProjectFile(projectFile.content, "project-b")).toEqual({
      kind: "quarantined",
      reason: "Project ID does not match the configured project.",
    });
    expect(
      validateProjectFile(
        JSON.stringify({ schemaVersion: 2, projectId: "project-a", defaultBranch: "main" }),
        "project-a",
      ),
    ).toEqual({ kind: "quarantined", reason: "Unsupported repository schema version." });
  });

  it("accepts a valid manifest and rejects invalid schema, project, and content hashes", () => {
    const manifest = createManifestFile({
      projectId: "project-a",
      defaultBranch: "main",
      memories: [sharedMemory()],
      generatedAt: "2026-09-12T01:00:00.000Z",
    });
    const parsed = JSON.parse(manifest.content) as Record<string, unknown>;

    expect(validateManifestFile(manifest.content, "project-a")).toMatchObject({
      kind: "valid",
      value: { schemaVersion: 1, projectId: "project-a", defaultBranch: "main" },
    });
    expect(validateManifestFile(JSON.stringify({ ...parsed, schemaVersion: 2 }), "project-a")).toEqual({
      kind: "quarantined",
      reason: "Unsupported repository schema version.",
    });
    expect(validateManifestFile(JSON.stringify({ ...parsed, projectId: "project-b" }), "project-a")).toEqual({
      kind: "quarantined",
      reason: "Project ID does not match the configured project.",
    });
    expect(validateManifestFile(JSON.stringify({ ...parsed, memories: [{ id: "mem_1", contentHash: "bad" }] }), "project-a"))
      .toEqual({ kind: "quarantined", reason: "Manifest has an invalid format." });
  });

  it("quarantines unsafe, malformed, and unexpected-status remote records without rejecting valid files", () => {
    const valid = createMemoryFile(memory()).content;
    const secret = remoteMemory(sharedMemory({ id: "mem_secret", content: "token=abcdefgh" }));
    const unexpectedStatus = remoteMemory(sharedMemory({ id: "mem_pending", status: "pending" as "active" }));

    const result = validateMemoryFiles(
      [
        { path: ".openmembrane/memories/mem_1.json", content: valid },
        { path: ".openmembrane/memories/mem_secret.json", content: secret },
        { path: ".openmembrane/memories/mem_pending.json", content: unexpectedStatus },
        { path: ".openmembrane/memories/broken.json", content: "{ not json" },
      ],
      "project-a",
    );

    expect(result.valid).toEqual([sharedMemory()]);
    expect(result.quarantined).toEqual([
      { path: ".openmembrane/memories/mem_secret.json", reason: "Remote record contains secret material." },
      { path: ".openmembrane/memories/mem_pending.json", reason: "Remote record has an unsupported status." },
      { path: ".openmembrane/memories/broken.json", reason: "Remote record is not valid JSON." },
    ]);
  });

  it("compares the authoritative memory-file set for a full rebuild", () => {
    const result = compareFullRebuild(
      [sharedMemory({ id: "mem_1", content: "Old." }), sharedMemory({ id: "mem_2" })],
      [sharedMemory({ id: "mem_1", content: "New." }), sharedMemory({ id: "mem_3" })],
    );

    expect(result).toEqual({
      unchanged: false,
      upsert: [sharedMemory({ id: "mem_1", content: "New." }), sharedMemory({ id: "mem_3" })],
      remove: ["mem_2"],
      quarantined: [],
    });
  });

  it("quarantines duplicate authoritative IDs during a full rebuild", () => {
    const result = compareFullRebuild(
      [],
      [sharedMemory({ id: "mem_1", content: "First." }), sharedMemory({ id: "mem_1", content: "Second." })],
    );

    expect(result).toEqual({
      unchanged: true,
      upsert: [],
      remove: [],
      quarantined: [{ id: "mem_1", reason: "Duplicate authoritative memory ID." }],
    });
  });
});
