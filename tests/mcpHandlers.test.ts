import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenMembrainContext } from "../apps/mcp-server/src/context";
import { safeJsonResult } from "../apps/mcp-server/src/server";
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

  it("logs safe diagnostics for user-facing MCP tool errors", async () => {
    const { context, handlers } = await createHandlers();

    const result = await safeJsonResult(context, "propose_memory_from_session", {}, () =>
      handlers.proposeMemoryFromSession({})
    );

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as {
      error: { code: string; message: string; diagnosticId: string };
    };

    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.message).toBe("Either a session transcript or summary is required.");
    expect(payload.error.diagnosticId).toMatch(/^diag_/);

    const diagnostics = await handlers.getDiagnostics({});
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.id).toBe(payload.error.diagnosticId);
    expect(diagnostics[0]?.operation).toBe("propose_memory_from_session");
  });

  it("exposes audit events for memory pipeline activity", async () => {
    const { handlers } = await createHandlers();

    await handlers.proposeMemoryFromSession({
      transcript: "rule: Frontend tests require runtime config to be mocked."
    });

    const auditLog = await handlers.listAuditLog({});
    expect(auditLog.map((event) => event.type)).toContain("session_ingested");
    expect(auditLog.map((event) => event.type)).toContain("memory_saved");
  });

  it("updates a saved memory through the update handler", async () => {
    const { handlers } = await createHandlers();

    const proposed = await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules."
    });
    const savedMemory = proposed.saved[0]!;

    const updated = await handlers.updateMemory({
      memoryId: savedMemory.id,
      content: "This project uses Angular standalone components exclusively.",
      tags: ["angular", "frontend"]
    });

    expect(updated.content).toBe("This project uses Angular standalone components exclusively.");
    expect(updated.tags).toEqual(["angular", "frontend"]);
    expect(updated.id).toBe(savedMemory.id);

    const found = await handlers.searchMemory({ query: "Angular standalone" });
    expect(found).toHaveLength(1);
    expect(found[0]!.content).toBe("This project uses Angular standalone components exclusively.");

    const auditLog = await handlers.listAuditLog({});
    expect(auditLog.map((event) => event.type)).toContain("memory_updated");
  });

  it("returns error when updating memory with secret content", async () => {
    const { context, handlers } = await createHandlers();

    const proposed = await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules."
    });
    const savedMemory = proposed.saved[0]!;

    const result = await safeJsonResult(context, "update_memory", { memoryId: savedMemory.id }, () =>
      handlers.updateMemory({
        memoryId: savedMemory.id,
        content: "Use API key AKIA1234567890ABCDEF for deployments."
      })
    );

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as {
      error: { code: string; diagnosticId: string };
    };
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.diagnosticId).toMatch(/^diag_/);
  });

  it("relocates storage when type changes via update", async () => {
    const { handlers } = await createHandlers();

    const proposed = await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules."
    });
    const savedMemory = proposed.saved[0]!;
    expect(savedMemory.type).toBe("coding_rule");

    await handlers.updateMemory({
      memoryId: savedMemory.id,
      type: "known_gotcha"
    });

    // Should find exactly one result, not a duplicate at the old path
    const allRules = await handlers.searchMemory({ query: "Angular" });
    expect(allRules).toHaveLength(1);
    expect(allRules[0]!.type).toBe("known_gotcha");
    expect(allRules[0]!.id).toBe(savedMemory.id);
  });

  it("getRelevantContext ranks coding rules above session summaries", async () => {
    const { context, handlers } = await createHandlers();

    // Save two memories with similar content but different types directly
    const { JsonMemoryStore } = await import("@openmembrain/storage");
    const store = context.memoryStore;

    const { entry: entryFactory } = await import("./unit/helpers");
    await store.save(entryFactory({
      id: "mem_summary",
      type: "session_summary",
      content: "We discussed React hooks for state management.",
      confidence: "medium",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));
    await store.save(entryFactory({
      id: "mem_rule",
      type: "coding_rule",
      content: "Always use React hooks for state management.",
      confidence: "high",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));

    const results = await handlers.getRelevantContext({ query: "React hooks state" });

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("mem_rule");
    expect(results[1]!.id).toBe("mem_summary");
  });

  it("searchMemory ranks by text relevance over type", async () => {
    const { context, handlers } = await createHandlers();

    const store = context.memoryStore;
    const { entry: entryFactory } = await import("./unit/helpers");

    await store.save(entryFactory({
      id: "mem_rule",
      type: "coding_rule",
      content: "React components should follow the container pattern.",
      confidence: "high",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));
    await store.save(entryFactory({
      id: "mem_fact",
      type: "project_fact",
      content: "React hooks manage component state and side effects in this project.",
      confidence: "high",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));

    const results = await handlers.searchMemory({ query: "React hooks state" });

    // Both match "react", but mem_fact matches all three tokens while mem_rule only matches one
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("mem_fact");
  });

  it("getRelevantContext respects limit after ranking", async () => {
    const { context, handlers } = await createHandlers();

    const store = context.memoryStore;
    const { entry: entryFactory } = await import("./unit/helpers");

    for (let i = 0; i < 5; i++) {
      await store.save(entryFactory({
        id: `mem_${i}`,
        content: `React pattern number ${i} for components.`,
        updatedAt: `2026-05-0${i + 1}T00:00:00.000Z`
      }));
    }

    const results = await handlers.getRelevantContext({ query: "React", limit: 2 });
    expect(results).toHaveLength(2);
  });
});
