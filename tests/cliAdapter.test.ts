import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateTeamRunner, setupSurfaceDaemon } from "./integration/surfaces/helpers";
import { LlmMemoryExtractor } from "@openmembrane/extractor-llm";
import { OpenMembraneClient } from "@openmembrane/client";

const fixtures: Awaited<ReturnType<typeof setupSurfaceDaemon>>[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function setup(options: Parameters<typeof setupSurfaceDaemon>[0] = {}) {
  vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "mock");
  vi.stubEnv("OPENMEMBRANE_EXTRACTION_ENABLED", "false");
  const fixture = await setupSurfaceDaemon(options);
  fixtures.push(fixture);
  return fixture;
}

describe("CLI subprocess and real daemon", { timeout: 90_000 }, () => {
  it("exercises ingestion, context, every management operation, and all output formats", async () => {
    const { cli, client, root, projectRoot } = await setup();
    expect(await client.health()).toEqual({});
    const transcript = join(root, "session.txt");
    await writeFile(transcript, "rule: This project must use strict TypeScript mode.");
    const ingested = JSON.parse((await cli(["ingest", "--file", transcript, "--tool", "codex"])).stdout);
    expect(ingested.savedCount).toBe(1);
    const chat = JSON.stringify([{ role: "assistant", content: "Project instructions:\nrule: This project must deploy only after integration verification." }]);
    expect(JSON.parse((await cli(["ingest", "--stdin", "--format", "openai-chat", "--output", "json"], chat)).stdout).savedCount).toBe(1);
    expect((await cli(["ingest", "--stdin", "--output", "markdown"], "rule: Database backups must be verified before migration.")).stdout).toContain("```json");
    expect((await cli(["ingest", "--stdin", "--output", "text"], "rule: Release artifacts must be signed before publication.")).stdout).toContain("savedCount: 1");

    const context = await cli(["context", "--output", "json"]);
    const memories = JSON.parse(context.stdout);
    expect(memories.some((memory: { content: string }) => memory.content.includes("strict TypeScript"))).toBe(true);
    expect(context.stderr).toContain("4 memory candidates are waiting");
    expect((await cli(["context", "--query", "TypeScript", "--output", "markdown"])).stdout).toContain("## coding rule");
    expect((await cli(["context", "--type", "coding_rule", "--scope", "frontend"])).stdout).toContain("Found");

    expect(JSON.parse((await cli(["candidates", "list", "--output", "json"])).stdout)).toHaveLength(4);
    expect(JSON.parse((await cli(["candidates", "approve", "approve candidate", "--output", "json"])).stdout).status).toBe("active");
    expect(JSON.parse((await cli(["candidates", "reject", "reject-candidate", "--reason", "Obsolete", "--output", "json"])).stdout).rejected).toBe(true);
    const bulk = JSON.parse((await cli(["candidates", "approve-all", "--output", "json"])).stdout);
    expect(bulk.approved).toHaveLength(1);
    expect(bulk.skipped).toMatchObject([{ candidateId: "secret-candidate" }]);
    expect(JSON.parse((await cli(["candidates", "reject-all", "--output", "json"])).stdout).rejectedCount).toBe(1);

    const updated = JSON.parse((await cli(["memory", "update", "old memory", "--content", "The frontend must use strict ESM TypeScript modules.", "--type", "coding_rule", "--scope", "frontend", "--tags", "esm,typescript", "--output", "json"])).stdout);
    expect(updated).toMatchObject({ scope: "frontend", tags: ["esm", "typescript"] });
    const stale = JSON.parse((await cli(["memory", "stale", "--stale-after-months", "6", "--output", "json"])).stdout);
    expect(Array.isArray(stale)).toBe(true);
    expect(JSON.parse((await cli(["memory", "supersede", "old memory", "--reason", "Replaced", "--replacement-id", ingested.saved[0].id, "--output", "json"])).stdout)).toMatchObject({
      status: "superseded", supersededBy: ingested.saved[0].id,
    });

    const preview = JSON.parse((await cli(["export", "--targets", "agents", "--preview", "--output", "json"])).stdout);
    expect(preview.files[0].content).toContain("strict TypeScript");
    expect(preview.files[0].content).not.toContain("Private deployment architecture");
    await expect(stat(join(projectRoot, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await cli(["export", "--targets", "agents", "--output-dir", "generated", "--include-confidential"]);
    expect(await readFile(join(projectRoot, "generated", "AGENTS.md"), "utf8")).toContain("Private deployment architecture");
    const diagnostics = JSON.parse((await cli(["diagnostics", "--severity", "info", "--code", "EXTRACTION_MOCK_FALLBACK", "--limit", "2", "--output", "json"])).stdout);
    expect(diagnostics).toHaveLength(1);
    expect(JSON.parse((await cli(["audit", "--limit", "2", "--output", "json"])).stdout)).toHaveLength(2);
    expect((await cli(["audit", "--output", "markdown"])).stdout).toContain("```json");
  });

  it("configures GitHub Team and reports status through the daemon", async () => {
    const { cli } = await setup({ runner: new PrivateTeamRunner() });
    expect(JSON.parse((await cli(["team", "status", "--output", "json"])).stdout).mode).toBe("local_private");
    expect(JSON.parse((await cli(["team", "configure", "--host", "github.example.test", "--owner", "team", "--repo", "memory", "--output", "json"])).stdout).kind).toBe("configured");
    expect(JSON.parse((await cli(["team", "status", "--output", "json"])).stdout)).toMatchObject({
      mode: "github_team", repository: { host: "github.example.test", owner: "team", name: "memory" },
    });
  });

  it("returns context with a diagnostic warning when only the pending reminder fails", async () => {
    const { cli, client, storageDir, root } = await setup();
    await writeFile(join(storageDir, "pending", "coding_rule", "frontend", "approve candidate.json"), "{");
    const result = await client.getCliContext();
    expect(result.memories).toHaveLength(2);
    expect(result.pendingCandidateCount).toBeNull();
    expect(result).toMatchObject({
      pendingReminderError: { code: "STORAGE_INVALID_JSON", diagnosticId: expect.any(String) },
    });
    const context = await cli(["context", "--output", "json"]);
    expect(JSON.parse(context.stdout)).toHaveLength(2);
    expect(context.stderr).toContain("Context retrieved, but the pending reminder is unavailable [STORAGE_INVALID_JSON]");
    expect(context.stderr).toMatch(/diagnostic: diag_/);
    expect(context.stderr).not.toContain(storageDir);
    expect(await readFile(join(root, ".openmembrane", "logs", "daemon.log"), "utf8")).toContain("pending_reminder_failed");
    await writeFile(join(storageDir, "memories", "coding_rule", "frontend", "old memory.json"), "{");
    await expect(client.getCliContext()).rejects.toMatchObject({ code: "STORAGE_INVALID_JSON" });
    await expect(cli(["context", "--output", "json"])).rejects.toMatchObject({
      stdout: "", stderr: expect.stringContaining("STORAGE_INVALID_JSON"),
    });
  });

  it("honors caller extraction opt-outs when the daemon has remote extraction enabled", async () => {
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "llm");
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_ENABLED", "true");
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_API_KEY", "unused-fixture-key");
    const remoteExtract = vi.spyOn(LlmMemoryExtractor.prototype, "extract").mockResolvedValue([]);
    const fixture = await setupSurfaceDaemon();
    fixtures.push(fixture);
    const remoteClient = new OpenMembraneClient({
      ...fixture.clientOptions,
      env: { ...fixture.env, OPENMEMBRANE_EXTRACTION_ENABLED: "true", OPENMEMBRANE_EXTRACTION_PROVIDER: "llm" },
    });
    await remoteClient.ingest({ transcript: "Ordinary transcript for the remote extractor control." });
    expect(remoteExtract).toHaveBeenCalledOnce();
    remoteExtract.mockClear();

    for (const overrides of [
      { OPENMEMBRANE_EXTRACTION_ENABLED: "false", OPENMEMBRANE_EXTRACTION_PROVIDER: "llm" },
      { OPENMEMBRANE_EXTRACTION_ENABLED: "true", OPENMEMBRANE_EXTRACTION_PROVIDER: "mock" },
    ]) {
      const output = await fixture.cli(["ingest", "--stdin"], "rule: Use strict TypeScript before deployment.", overrides);
      const result = JSON.parse(output.stdout);
      expect(result.savedCount + result.pendingCount + result.rejectedCount).toBe(1);
      expect(remoteExtract).not.toHaveBeenCalled();
    }
    await remoteClient.ingest({ transcript: "The daemon's configured extractor is still unchanged." });
    expect(remoteExtract).toHaveBeenCalledOnce();
  });

  it("preserves untruncated context and caller project overrides", async () => {
    const { cli, projectRoot } = await setup({ many: true });
    const result = await cli(["context", "--output", "json"]);
    expect(JSON.parse(result.stdout)).toHaveLength(207);
    expect(result.stderr).toContain("209 memory candidates");
    expect(JSON.parse((await cli(["context", "--project", "other-project", "--output", "json"])).stdout)).toEqual([]);
    await expect(stat(join(projectRoot, ".openmembrane"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports safe daemon errors and fails rather than falling back to local stores", async () => {
    const { cli, root } = await setup();
    await expect(cli(["candidates", "approve", "secret-candidate"])).rejects.toMatchObject({
      code: 1, stderr: expect.stringMatching(/SECRET_CANDIDATE.*diagnostic:/), stdout: "",
    });
    await expect(cli(["memory", "update", "missing", "--content", "Missing memories must produce safe errors."])).rejects.toMatchObject({
      code: 1, stderr: expect.stringMatching(/MEMORY_NOT_FOUND.*diagnostic:/),
    });
    await expect(cli(["ingest", "--stdin"], "")).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Input is empty") });
    const missingHome = join(root, "no-daemon");
    await mkdir(missingHome);
    await expect(cli(["context"], undefined, { HOME: missingHome, USERPROFILE: missingHome, XDG_RUNTIME_DIR: missingHome })).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining("daemon is not running"), stdout: "",
    });
  });
});
