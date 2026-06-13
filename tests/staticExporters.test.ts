import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryEntry } from "@openmembrane/core";
import { StaticMemoryExportService } from "@openmembrane/exporters";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openmembrane-export-test-"));
  tempDirs.push(dir);
  return dir;
}

function memory(overrides: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "mem_1",
    projectId: "project-a",
    type: "coding_rule",
    content: "This project uses Angular standalone components.",
    scope: "frontend",
    confidence: "high",
    sensitivity: "internal",
    source: { kind: "session" },
    reason: "test",
    tags: [],
    status: "active",
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
    ...overrides
  };
}

describe("StaticMemoryExportService", () => {
  it("previews all static fallback files and excludes confidential memory by default", () => {
    const service = new StaticMemoryExportService();
    const result = service.preview(
      "project-a",
      [
        memory({ content: "This project uses Angular standalone components." }),
        memory({
          id: "mem_2",
          type: "security_rule",
          content: "Deployed environments use JWT/OIDC.",
          scope: "security",
          sensitivity: "confidential"
        })
      ],
      { generatedAt: "2026-05-08T00:00:00.000Z" }
    );

    expect(result.files.map((file) => file.path)).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      ".github/copilot-instructions.md",
      ".cursor/rules/openmembrane.mdc",
      "docs/ai/project-memory.md"
    ]);
    expect(result.files[0]?.content).toContain("Angular standalone components");
    expect(result.files[0]?.content).not.toContain("JWT/OIDC");
    expect(result.files[0]?.memoryCount).toBe(1);
  });

  it("includes usage preamble with MCP tool instructions in all exported files", () => {
    const service = new StaticMemoryExportService();
    const result = service.preview("project-a", [], { generatedAt: "2026-05-08T00:00:00.000Z" });

    for (const file of result.files) {
      expect(file.content).toContain("## Using OpenMembrane");
      expect(file.content).toContain("get_project_rules");
      expect(file.content).toContain("get_relevant_context");
      expect(file.content).toContain("propose_memory_from_session");
      expect(file.content).toContain("list_memory_candidates");
    }
  });

  it("writes generated files to disk", async () => {
    const outputDir = await tempDir();
    const service = new StaticMemoryExportService();

    await service.write({
      projectId: "project-a",
      outputDir,
      memories: [memory({ content: "Frontend tests require runtime config to be mocked.", type: "testing_rule", scope: "testing" })],
      targets: ["agents", "cursor"],
      generatedAt: "2026-05-08T00:00:00.000Z"
    });

    const agents = await readFile(join(outputDir, "AGENTS.md"), "utf8");
    const cursor = await readFile(join(outputDir, ".cursor", "rules", "openmembrane.mdc"), "utf8");

    expect(agents).toContain("Frontend tests require runtime config to be mocked.");
    expect(cursor).toMatch(/^---\ndescription: OpenMembrane project memory\nalwaysApply: true\n---/);
  });
});
