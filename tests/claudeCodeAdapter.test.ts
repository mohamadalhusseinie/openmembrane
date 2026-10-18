import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
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
  const output = await new Promise<{ code: number | null; stderr: string }>((accept, reject) => {
    const child = spawn(hook.command, hook.args, {
      cwd: fixture.projectRoot,
      env: { ...fixture.env, NODE_OPTIONS: `--import=${loader}`, CAPTURE_PID: join(fixture.root, "ingest.pid") },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => accept({ code, stderr }));
    child.stdin.end(input);
  });
  expect(output).toEqual({ code: 0, stderr: "" });
  try {
    await expect.poll(async () => {
      const [memories, candidates] = await Promise.all([
        fixture.client.searchMemory({ query: "strict TypeScript" }),
        fixture.client.listMemoryCandidates(),
      ]);
      return [...memories, ...candidates].some((memory) =>
        memory.content.includes("strict TypeScript") && memory.source.tool === "claude-code");
    }, { timeout: 10_000 }).toBe(true);
  } catch (error) {
    throw new Error(`Capture failed: ${await readFile(join(configDir, "openmembrane-capture.log"), "utf8")}`, { cause: error });
  } finally {
    const pid = Number(await readFile(join(fixture.root, "ingest.pid"), "utf8"));
    await expect.poll(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
        throw error;
      }
    }, { timeout: 10_000 }).toBe(true);
  }
});
