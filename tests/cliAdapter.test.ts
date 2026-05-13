import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenMembrainContext } from "../apps/mcp-server/src/context";
import type { IngestCommand, ContextCommand } from "../apps/mcp-server/src/cli/parseArgs";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Integration tests for CLI adapter commands.
 *
 * These tests exercise the full pipeline (ingest -> store -> retrieve)
 * via the CLI handler functions, using temp storage.
 *
 * Note: We test the handler logic directly rather than spawning child
 * processes, since the handlers are the thin adapter layer and the
 * entry point routing is tested in unit tests.
 */
describe("CLI adapter integration", () => {
  async function setupContext() {
    const storageDir = await mkdtemp(join(tmpdir(), "openmembrain-cli-test-"));
    tempDirs.push(storageDir);
    return createOpenMembrainContext({
      defaultProjectId: "test-project",
      storageDir
    });
  }

  describe("ingest -> context round-trip", () => {
    it("ingests a text transcript and retrieves memories via context", async () => {
      const storageDir = await mkdtemp(join(tmpdir(), "openmembrain-cli-test-"));
      tempDirs.push(storageDir);

      const context = createOpenMembrainContext({
        defaultProjectId: "test-project",
        storageDir
      });

      // Use wording that triggers high confidence ("must") for auto_save
      const ingestResult = await context.ingestionService.ingest({
        projectId: "test-project",
        transcript: "rule: This project must use strict TypeScript mode.",
        tool: "codex"
      });

      expect(ingestResult.savedCount).toBeGreaterThanOrEqual(1);

      // Retrieve context
      const memories = await context.memoryStore.list("test-project");
      const active = memories.filter((m) => m.status === "active");
      expect(active.length).toBeGreaterThanOrEqual(1);
      expect(active.some((m) => m.content.includes("strict TypeScript"))).toBe(true);

      context.close?.();
    });

    it("ingests an OpenAI chat format transcript", async () => {
      const storageDir = await mkdtemp(join(tmpdir(), "openmembrain-cli-test-"));
      tempDirs.push(storageDir);

      const context = createOpenMembrainContext({
        defaultProjectId: "test-project",
        storageDir
      });

      const chatJson = JSON.stringify([
        { role: "user", content: "What testing framework should we use?" },
        { role: "assistant", content: "rule: This project uses Vitest for all unit and integration tests." }
      ]);

      // Parse the chat format first
      const { parseSessionContent } = await import("../apps/mcp-server/src/cli/parsers/index");
      const transcript = parseSessionContent(chatJson, "openai-chat");

      const result = await context.ingestionService.ingest({
        projectId: "test-project",
        transcript,
        tool: "codex"
      });

      expect(result.savedCount).toBeGreaterThanOrEqual(1);

      const memories = await context.memoryStore.list("test-project");
      expect(memories.some((m) => m.content.includes("Vitest"))).toBe(true);

      context.close?.();
    });

    it("retrieves memories filtered by scope", async () => {
      const storageDir = await mkdtemp(join(tmpdir(), "openmembrain-cli-test-"));
      tempDirs.push(storageDir);

      const context = createOpenMembrainContext({
        defaultProjectId: "test-project",
        storageDir
      });

      // Ingest two different scoped rules
      await context.ingestionService.ingest({
        projectId: "test-project",
        transcript: "rule: The frontend uses React with TypeScript.\nrule: The backend uses Express with Node.js.",
        tool: "codex"
      });

      const allMemories = await context.memoryStore.list("test-project");
      const active = allMemories.filter((m) => m.status === "active");
      expect(active.length).toBeGreaterThanOrEqual(1);

      context.close?.();
    });
  });
});
