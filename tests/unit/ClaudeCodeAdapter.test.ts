import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { updateInstructions, updateSettings } from "../../packages/adapter-claude-code/src/config";
import type { HookCommand } from "../../packages/adapter-claude-code/src/config";
import { installAdapter } from "../../packages/adapter-claude-code/src/installer";
import { parseHookInput, sessionTranscript } from "../../packages/adapter-claude-code/src/transcript";

const fixtures = fileURLToPath(new URL("./fixtures/claude-code/", import.meta.url));
const fixture = async (name: string) => (await readFile(join(fixtures, name), "utf8")).replace(/\r\n/g, "\n");
const hook: HookCommand = { type: "command", command: "node", args: ["capture.mjs", "openmembrane.js", "capture.log"], timeout: 60 };
const directories: string[] = [];
async function temporary(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmembrane-claude-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

describe("Claude Code configuration", () => {
  it("matches golden files and is idempotent", async () => {
    const settings = updateSettings(await fixture("settings.json"), hook, true);
    const instructions = updateInstructions(await fixture("CLAUDE.md"), true);
    expect(settings).toBe(await fixture("installed-settings.json"));
    expect(instructions).toBe(await fixture("installed-CLAUDE.md"));
    expect(updateSettings(settings, hook, true)).toBe(settings);
    expect(updateInstructions(instructions, true)).toBe(instructions);
    expect(JSON.parse(updateSettings(settings, hook, false))).toEqual(JSON.parse(await fixture("settings.json")));
  });

  it("opts into Stop only explicitly and removes only its own handler in mixed groups", async () => {
    const settings = updateSettings(await fixture("settings.json"), hook, true, true);
    const parsed = JSON.parse(settings);
    expect(parsed.hooks.Stop).toHaveLength(2);
    parsed.hooks.SessionEnd[1].hooks.push({ type: "command", command: "keep-me" });
    const removed = JSON.parse(updateSettings(JSON.stringify(parsed), hook, false));
    expect(removed.hooks.SessionEnd[1].hooks).toEqual([{ type: "command", command: "keep-me" }]);
    expect(removed.hooks.Stop).toHaveLength(1);
    expect(JSON.parse(updateSettings(settings, hook, true)).hooks.Stop).toHaveLength(1);
  });

  it("preserves unrelated empty hook groups", () => {
    const content = '{"hooks":{"Stop":[{"matcher":"custom","hooks":[]}]}}';
    expect(JSON.parse(updateSettings(content, hook, true)).hooks.Stop).toEqual([{ matcher: "custom", hooks: [] }]);
  });

  it("refuses malformed settings and ambiguous instruction markers", () => {
    for (const content of ["[]", '{"hooks":[]}', '{"hooks":{"Stop":{}}}', '{"hooks":{"Stop":[{}]}}']) {
      expect(() => updateSettings(content, hook, true)).toThrow();
    }
    for (const content of ["<!-- openmembrane:start -->", "<!-- openmembrane:end -->",
      "<!-- openmembrane:end --><!-- openmembrane:start -->",
      "<!-- openmembrane:start --><!-- openmembrane:end --><!-- openmembrane:start -->"]) {
      expect(() => updateInstructions(content, true)).toThrow("Malformed");
    }
  });

  it("restores original file bytes after repeated installs", async () => {
    const directory = await temporary();
    const settings = (await fixture("settings.json")).replace(/\n/g, "\r\n");
    const instructions = "# Custom instructions without a trailing newline";
    await writeFile(join(directory, "settings.json"), settings);
    await writeFile(join(directory, "CLAUDE.md"), instructions);
    const install = (enabled: boolean, incremental = false) =>
      installAdapter(enabled, incremental, directory, join(fixtures, "cli.mjs"), join(fixtures, "cli.mjs"));
    await install(true);
    const once = await readFile(join(directory, "settings.json"), "utf8");
    await install(true);
    expect(await readFile(join(directory, "settings.json"), "utf8")).toBe(once);
    await install(true, true);
    await install(false);
    expect(await readFile(join(directory, "settings.json"), "utf8")).toBe(settings);
    expect(await readFile(join(directory, "CLAUDE.md"), "utf8")).toBe(instructions);
    await expect(readFile(join(directory, "openmembrane-adapter-state.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await install(false);
  });

  it("removes newly created files and preserves subsequent user edits", async () => {
    const directory = await temporary();
    const install = (enabled: boolean) =>
      installAdapter(enabled, false, directory, join(fixtures, "cli.mjs"), join(fixtures, "cli.mjs"));
    await install(true);
    await install(false);
    await expect(readFile(join(directory, "settings.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(directory, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await install(true);
    const settings = JSON.parse(await readFile(join(directory, "settings.json"), "utf8"));
    settings.theme = "dark";
    settings.hooks.SessionEnd.push({ hooks: [{ type: "command", command: "custom" }] });
    await writeFile(join(directory, "settings.json"), JSON.stringify(settings));
    await writeFile(join(directory, "CLAUDE.md"), await readFile(join(directory, "CLAUDE.md"), "utf8") + "\nNew user text.\n");
    await install(true);
    await install(false);
    expect(JSON.parse(await readFile(join(directory, "settings.json"), "utf8"))).toEqual({
      theme: "dark", hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "custom" }] }] },
    });
    expect(await readFile(join(directory, "CLAUDE.md"), "utf8")).toContain("New user text.");
    expect(await readFile(join(directory, "CLAUDE.md"), "utf8")).not.toContain("openmembrane:start");
  });

  it("does not modify either file when validation fails", async () => {
    const directory = await temporary();
    await writeFile(join(directory, "settings.json"), '{"hooks": []}');
    await writeFile(join(directory, "CLAUDE.md"), "Keep me");
    await expect(installAdapter(true, false, directory, join(fixtures, "cli.mjs"), join(fixtures, "cli.mjs"))).rejects.toThrow();
    expect(await readFile(join(directory, "CLAUDE.md"), "utf8")).toBe("Keep me");
    await expect(readFile(join(directory, "openmembrane-capture.mjs"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Claude Code transcript ingestion", () => {
  it("converts the real JSONL record shapes to the expected text fixture", async () => {
    expect(sessionTranscript(await fixture("session.jsonl")) + "\n").toBe(await fixture("transcript.txt"));
    expect(() => sessionTranscript('{"type":"user"}')).toThrow("Missing message");
    expect(() => sessionTranscript("{invalid}")).toThrow("line 1");
    expect(() => parseHookInput("{}")).toThrow("Expected");
  });

  async function capture(input: string, directory: string, fail = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const tsx = createRequire(import.meta.url).resolve("tsx/cli");
    const script = fileURLToPath(new URL("../../packages/adapter-claude-code/src/capture.ts", import.meta.url));
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [tsx, script, join(fixtures, "cli.mjs"), join(directory, "capture.log")], {
        env: { ...process.env, CAPTURE_RESULT: join(directory, "result.jsonl"), FAIL_CAPTURE: fail },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input);
    });
  }

  it.each(["SessionEnd", "Stop"])("pipes fixture text to CLI ingest from the project cwd for %s", async (event) => {
    const directory = await temporary();
    const result = await capture(JSON.stringify({
      hook_event_name: event, cwd: directory, transcript_path: join(fixtures, "session.jsonl"),
    }), directory);
    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
    let calls: unknown[] = [];
    await expect.poll(async () => {
      calls = (await readFile(join(directory, "result.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      return calls.length;
    }).toBe(2);
    expect(calls).toEqual([
      { args: ["start"], cwd: directory, input: "" },
      { args: ["ingest", "--stdin", "--tool", "claude-code", "--format", "text"], cwd: directory,
        input: (await fixture("transcript.txt")).trimEnd() },
    ]);
  });

  it("reports failures without echoing transcript content and never ingests if startup fails", async () => {
    const directory = await temporary();
    const result = await capture(JSON.stringify({
      hook_event_name: "SessionEnd", cwd: directory, transcript_path: join(fixtures, "session.jsonl"),
    }), directory, "start");
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("capture failed");
    expect(result.stderr).not.toContain("TypeScript");
    expect((await readFile(join(directory, "result.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("records detached ingestion failures in the local log", async () => {
    const directory = await temporary();
    const result = await capture(JSON.stringify({
      hook_event_name: "SessionEnd", cwd: directory, transcript_path: join(fixtures, "session.jsonl"),
    }), directory, "ingest");
    expect(result.code).toBe(0);
    await expect.poll(() => readFile(join(directory, "capture.log"), "utf8")).toContain("Fixture command failed.");
  });

  it("rejects invalid payloads and skips transcripts with no conversation text", async () => {
    const directory = await temporary();
    expect((await capture("{}", directory)).code).toBe(1);
    const path = join(directory, "empty.jsonl");
    await writeFile(path, '{"type":"system"}\n');
    expect((await capture(JSON.stringify({ hook_event_name: "SessionEnd", cwd: directory, transcript_path: path }), directory)).code).toBe(0);
    await expect(readFile(join(directory, "result.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
