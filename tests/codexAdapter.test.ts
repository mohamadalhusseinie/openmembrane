import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { build } from "tsup";
import { installAdapter } from "../packages/adapter-codex/src/installer";
import { setupSurfaceDaemon } from "./integration/surfaces/helpers";

const fixtures: Awaited<ReturnType<typeof setupSurfaceDaemon>>[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  vi.unstubAllEnvs();
});

it("captures through installed Codex shell hooks and the real daemon without duplicating rejected sessions", { timeout: 40_000 }, async () => {
  vi.stubEnv("OPENMEMBRANE_EXTRACTION_ENABLED", "false");
  vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "mock");
  const fixture = await setupSurfaceDaemon();
  fixtures.push(fixture);
  const configDir = join(fixture.root, "codex config ' & $");
  const outDir = join(fixture.root, "bundle");
  await build({
    entry: {
      index: resolve("packages", "adapter-codex", "src", "index.ts"),
      capture: resolve("packages", "adapter-codex", "src", "capture.ts"),
    },
    outDir, format: ["esm"], target: "node18", config: false, silent: true, splitting: false,
  });
  await installAdapter(true, configDir, join(outDir, "capture.js"),
    resolve("tests", "unit", "fixtures", "claude-code", "real-cli.mjs"));
  const config = JSON.parse(await readFile(join(configDir, "hooks.json"), "utf8"));
  const command: string = config.hooks.SessionEnd[0].hooks[0].command;
  const transcript = join(fixture.root, "session.jsonl");
  const message = (text: string) => JSON.stringify({
    type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  });
  await writeFile(transcript, message("rule: Always use strict TypeScript in this project."));
  const loader = pathToFileURL(resolve("node_modules", "tsx", "dist", "loader.mjs")).href;

  async function captureSession(): Promise<void> {
    const pidPath = join(fixture.root, "ingest.pid");
    await rm(pidPath, { force: true });
    const output = await new Promise<{ code: number | null; stderr: string }>((accept, reject) => {
      const windows = process.platform === "win32";
      const child = spawn(windows ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh",
        windows ? ["/d", "/s", "/c", command] : ["-c", command], {
          cwd: fixture.projectRoot,
          env: { ...fixture.env, NODE_OPTIONS: `--import=${loader}`, CAPTURE_PID: pidPath },
          stdio: ["pipe", "ignore", "pipe"],
        });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", reject);
      child.once("close", (code) => accept({ code, stderr }));
      child.stdin.end(JSON.stringify({
        session_id: "codex-fixture", hook_event_name: "SessionEnd",
        cwd: fixture.projectRoot, transcript_path: transcript,
      }));
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
    }, { timeout: 15_000 }).toBe(true);
  }

  await captureSession();
  const first = (await fixture.client.listMemoryCandidates()).find((memory) =>
    memory.content.includes("strict TypeScript") && memory.source.tool === "codex");
  expect(first?.source.sessionId).toBe("codex-fixture");
  if (!first) throw new Error("Expected a captured rule awaiting approval.");
  await fixture.client.rejectMemoryCandidate({ candidateId: first.id, reason: "Not a project rule." });
  await captureSession();
  expect((await fixture.client.listMemoryCandidates()).some((memory) => memory.content.includes("strict TypeScript"))).toBe(false);
  const nextRule = "Release automation must verify package provenance before publishing.";
  await writeFile(transcript, await readFile(transcript, "utf8") + "\n" + message(`rule: ${nextRule}`));
  await captureSession();
  const captured = [...await fixture.client.listMemoryCandidates(), ...await fixture.client.searchMemory({ query: "package provenance" })];
  expect(captured.some((memory) => memory.content.includes(nextRule) && memory.source.sessionId === "codex-fixture")).toBe(true);
});
