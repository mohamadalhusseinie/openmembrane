import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenMembrainContext } from "../apps/mcp-server/src/context";
import { createToolHandlers } from "../apps/mcp-server/src/tools/handlers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createHandlers() {
  const storageDir = await mkdtemp(join(tmpdir(), "openmembrain-mcp-test-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "openmembrain-project-test-"));
  tempDirs.push(storageDir, projectRoot);

  const context = createOpenMembrainContext({
    defaultProjectId: "project-a",
    projectRoot,
    storageDir
  });

  return {
    context,
    handlers: createToolHandlers(context),
    projectRoot
  };
}

describe("MCP tool handlers", () => {
  it("proposes memory from a session and retrieves auto-saved project rules", async () => {
    const { handlers } = await createHandlers();

    const proposed = await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules.",
      tool: "codex"
    });

    expect(proposed.saved).toHaveLength(1);
    expect(proposed.pending).toHaveLength(0);

    const rules = await handlers.getProjectRules({});
    expect(rules).toHaveLength(1);
    expect(rules[0]?.content).toContain("Angular standalone components");

    const context = await handlers.getRelevantContext({ query: "Angular components" });
    expect(context).toHaveLength(1);
    expect(context[0]?.type).toBe("coding_rule");
  });

  it("approves pending architecture decisions through the approval handler", async () => {
    const { handlers } = await createHandlers();

    const proposed = await handlers.proposeMemoryFromSession({
      summary: "architecture: Runtime environment config is preferred over compile-time environment replacement."
    });

    expect(proposed.saved).toHaveLength(0);
    expect(proposed.pending).toHaveLength(1);

    const pending = await handlers.listMemoryCandidates({});
    expect(pending).toHaveLength(1);

    const approved = await handlers.approveMemoryCandidate({
      candidateId: pending[0]?.id ?? ""
    });

    expect(approved.type).toBe("architecture_decision");
    await expect(handlers.listMemoryCandidates({})).resolves.toHaveLength(0);

    const rules = await handlers.getProjectRules({});
    expect(rules.map((rule) => rule.id)).toContain(approved.id);
  });

  it("rejects pending candidates through the rejection handler", async () => {
    const { handlers } = await createHandlers();

    await handlers.proposeMemoryFromSession({
      transcript: "deployment: Database schema changes must use Flyway migrations."
    });

    const pending = await handlers.listMemoryCandidates({});
    expect(pending).toHaveLength(1);

    const rejection = await handlers.rejectMemoryCandidate({
      candidateId: pending[0]?.id ?? "",
      reason: "Needs confirmation later."
    });

    expect(rejection.rejected).toBe(true);
    await expect(handlers.listMemoryCandidates({})).resolves.toHaveLength(0);
    await expect(handlers.searchMemory({ query: "Flyway" })).resolves.toHaveLength(0);
  });

  it("exports static fallback memory files", async () => {
    const { handlers, projectRoot } = await createHandlers();

    await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules."
    });

    const exported = await handlers.exportStaticMemoryFiles({
      targets: ["agents", "project_memory"]
    });

    expect(exported.files.map((file) => file.path)).toEqual(["AGENTS.md", "docs/ai/project-memory.md"]);

    const agents = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    const projectMemory = await readFile(join(projectRoot, "docs", "ai", "project-memory.md"), "utf8");
    expect(agents).toContain("Angular standalone components");
    expect(projectMemory).toContain("Angular standalone components");
  });
});
