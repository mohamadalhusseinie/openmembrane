import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { build } from "tsup";
import { installAdapter } from "../packages/adapter-claude-code/src/installer";
import { setupSurfaceDaemon } from "./integration/surfaces/helpers";

const fixtures: Awaited<ReturnType<typeof setupSurfaceDaemon>>[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  vi.unstubAllEnvs();
});

it("captures a Claude Code session through the installed hook, CLI and real daemon", { timeout: 30_000 }, async () => {
  vi.stubEnv("OPENMEMBRANE_EXTRACTION_ENABLED", "false");
  vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "mock");
  const fixture = await setupSurfaceDaemon();
  fixtures.push(fixture);
  const configDir = join(fixture.root, "claude config");
  const capture = resolve("packages", "adapter-claude-code", "src", "capture.ts");
  const cli = resolve("tests", "unit", "fixtures", "claude-code", "real-cli.mjs");
  const outDir = join(fixture.root, "bundle");
  await build({ entry: { capture }, outDir, format: ["esm"], target: "node18", config: false, silent: true });
  await installAdapter(true, false, configDir, join(outDir, "capture.js"), cli);
  const config = JSON.parse(await readFile(join(configDir, "settings.json"), "utf8"));
  const hook = config.hooks.SessionEnd[0].hooks[0];
  const transcript = join(fixture.root, "session.jsonl");
  await writeFile(transcript, await readFile(fileURLToPath(new URL("./unit/fixtures/claude-code/session.jsonl", import.meta.url)), "utf8"));
  const loader = pathToFileURL(resolve("node_modules", "tsx", "dist", "loader.mjs")).href;
  const input = JSON.stringify({
    session_id: "claude-fixture", hook_event_name: "SessionEnd",
    cwd: fixture.projectRoot, transcript_path: transcript,
  });
  async function captureSession(): Promise<void> {
    const pidPath = join(fixture.root, "ingest.pid");
    await rm(pidPath, { force: true });
    const output = await new Promise<{ code: number | null; stderr: string }>((accept, reject) => {
      const child = spawn(hook.command, hook.args, {
        cwd: fixture.projectRoot,
        env: {
          ...fixture.env, NODE_OPTIONS: `--import=${loader}`, CLAUDE_PROJECT_DIR: fixture.projectRoot,
          CAPTURE_PID: pidPath,
        },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", reject);
      child.once("close", (code) => accept({ code, stderr }));
      child.stdin.end(input);
    });
    expect(output).toEqual({ code: 0, stderr: "" });
    await expect.poll(async () => {
      let pids: number[];
      try {
        pids = JSON.parse(await readFile(pidPath, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
      return pids.every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
          throw error;
        }
      });
    }, { timeout: 10_000 }).toBe(true);
  }
  await captureSession();
  const first = (await fixture.client.listMemoryCandidates()).find((memory) =>
    memory.content.includes("strict TypeScript") && memory.source.tool === "claude-code");
  expect(first?.source.sessionId).toBe("claude-fixture");
  if (!first) throw new Error("Expected a captured rule awaiting approval.");
  await fixture.client.rejectMemoryCandidate({ candidateId: first.id, reason: "Not a project rule." });
  const nextRule = "Release automation must verify package provenance before publishing.";
  await writeFile(transcript, await readFile(transcript, "utf8") + "\n" + JSON.stringify({
    type: "user", message: { content: `rule: ${nextRule}` },
  }));
  await captureSession();
  const pending = await fixture.client.listMemoryCandidates();
  expect(pending.some((memory) => memory.content.includes("strict TypeScript"))).toBe(false);
  const captured = [...pending, ...await fixture.client.searchMemory({ query: "package provenance" })];
  expect(captured.some((memory) => memory.content.includes(nextRule) && memory.source.sessionId === "claude-fixture")).toBe(true);
});
