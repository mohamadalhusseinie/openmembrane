import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MAX_TRANSCRIPT_LENGTH, prepareTranscriptChunks } from "@openmembrane/core";
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
  const path = await realpath(await mkdtemp(join(tmpdir(), "openmembrane-claude-")));
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

  it("resolves relative config paths and preserves files deleted after installation", async () => {
    const directory = await temporary();
    const install = (enabled: boolean) => installAdapter(
      enabled, false, relative(process.cwd(), directory), join(fixtures, "cli.mjs"), join(fixtures, "cli.mjs"),
    );
    await install(true);
    const settings = JSON.parse(await readFile(join(directory, "settings.json"), "utf8"));
    expect(settings.hooks.SessionEnd[0].hooks[0].args.every((arg: string) => isAbsolute(arg))).toBe(true);
    await unlink(join(directory, "settings.json"));
    await unlink(join(directory, "CLAUDE.md"));
    await install(false);
    await expect(readFile(join(directory, "settings.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(directory, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Claude Code transcript ingestion", () => {
  it("converts the real JSONL record shapes to the expected text fixture", async () => {
    expect(sessionTranscript(await fixture("session.jsonl")) + "\n").toBe(await fixture("transcript.txt"));
    expect(() => sessionTranscript('{"type":"user"}')).toThrow("Missing message");
    expect(() => sessionTranscript("{invalid}")).toThrow("line 1");
    expect(() => parseHookInput("{}")).toThrow("Expected");
  });

  it("includes Stop's final assistant text exactly once when the transcript lags", () => {
    const user = '{"type":"user","message":{"content":"Task"}}';
    const final = "Final assistant rule";
    const payload = parseHookInput(JSON.stringify({
      hook_event_name: "Stop", cwd: "/project", transcript_path: "/session.jsonl",
      session_id: "stable-session", last_assistant_message: final,
    }));
    const expected = `user:\nTask\n\nassistant:\n${final}`;
    expect(sessionTranscript(user, payload.lastAssistantMessage)).toBe(expected);
    expect(sessionTranscript(user + "\n" + JSON.stringify({
      type: "assistant", message: { content: final },
    }), final)).toBe(expected);
    expect(payload.sessionId).toBe("stable-session");
  });

  it("bounds all chunks without losing text or splitting Unicode surrogate pairs", () => {
    const transcript = "x".repeat(MAX_TRANSCRIPT_LENGTH - 1) + "\u{1F600}" + "\n" + "y".repeat(MAX_TRANSCRIPT_LENGTH * 2);
    const chunks = prepareTranscriptChunks(transcript);
    expect(chunks.join("")).toBe(transcript);
    expect(chunks.every((chunk) => chunk.length <= MAX_TRANSCRIPT_LENGTH)).toBe(true);
    expect(chunks.every((chunk) => Buffer.from(chunk).toString("utf8") === chunk)).toBe(true);
  });

  async function capture(input: string, directory: string, fail = "", projectRoot = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    const script = fileURLToPath(new URL("../../packages/adapter-claude-code/src/capture.ts", import.meta.url));
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, join(fixtures, "cli.mjs"), join(directory, "capture.log")], {
        env: {
          ...process.env, NODE_OPTIONS: `--import=${loader}`, CLAUDE_PROJECT_DIR: projectRoot,
          CAPTURE_RESULT: join(directory, "result.jsonl"), FAIL_CAPTURE: fail,
        },
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
      session_id: "session-123", hook_event_name: event, cwd: directory, transcript_path: join(fixtures, "session.jsonl"),
    }), directory);
    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
    let calls: unknown[] = [];
    await expect.poll(async () => {
      calls = (await readFile(join(directory, "result.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      return calls.length;
    }, { timeout: 10_000 }).toBe(2);
    expect(calls).toEqual([
      { args: ["start"], cwd: directory, input: "" },
      { args: ["ingest", "--stdin", "--tool", "claude-code", "--format", "text", "--session-id", "session-123"], cwd: directory,
        input: (await fixture("transcript.txt")).trimEnd() },
    ]);
  });

  it("anchors subprocesses to CLAUDE_PROJECT_DIR and chunks oversized individual turns", async () => {
    const directory = await temporary();
    const projectRoot = await temporary();
    const path = join(directory, "large.jsonl");
    const text = "x".repeat(MAX_TRANSCRIPT_LENGTH * 2 + 1);
    await writeFile(path, JSON.stringify({ type: "user", message: { content: text } }));
    const result = await capture(JSON.stringify({
      session_id: "long-session", hook_event_name: "SessionEnd", cwd: directory, transcript_path: path,
    }), directory, "", projectRoot);
    expect(result.code).toBe(0);
    let calls: { args: string[]; cwd: string; input: string }[] = [];
    await expect.poll(async () => {
      calls = (await readFile(join(directory, "result.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      return calls.length;
    }, { timeout: 10_000 }).toBe(4);
    expect(calls.every((call) => call.cwd === projectRoot)).toBe(true);
    const ingestions = calls.slice(1);
    expect(ingestions.every((call) => call.input.length <= MAX_TRANSCRIPT_LENGTH)).toBe(true);
    expect(ingestions.every((call) => call.args.slice(-2).join(" ") === "--session-id long-session")).toBe(true);
    expect(ingestions.map((call) => call.input).join("")).toBe(`user:\n${text}`);
  });

  it("redacts complete secrets before any bounded CLI request is created", async () => {
    const directory = await temporary();
    const path = join(directory, "private-key.jsonl");
    const key = "-----BEGIN PRIVATE KEY-----\n" + "PRIVATE_MATERIAL".repeat(100) + "\n-----END PRIVATE KEY-----";
    const text = "x".repeat(MAX_TRANSCRIPT_LENGTH - 100) + key + "\n" + "y".repeat(MAX_TRANSCRIPT_LENGTH);
    await writeFile(path, JSON.stringify({ type: "user", message: { content: text } }));
    expect((await capture(JSON.stringify({
      session_id: "private-session", hook_event_name: "SessionEnd", cwd: directory, transcript_path: path,
    }), directory)).code).toBe(0);
    let calls: { input: string }[] = [];
    await expect.poll(async () => {
      calls = (await readFile(join(directory, "result.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      return calls.length;
    }, { timeout: 10_000 }).toBe(3);
    const sent = calls.slice(1).map((call) => call.input).join("");
    expect(sent).toBe(`user:\n${text.replace(key, "[REDACTED:private_key]")}`);
    expect(sent).not.toContain("PRIVATE_MATERIAL");
  });

  it("reports failures without echoing transcript content and never ingests if startup fails", async () => {
    const directory = await temporary();
    const result = await capture(JSON.stringify({
      session_id: "session-123", hook_event_name: "SessionEnd", cwd: directory, transcript_path: join(fixtures, "session.jsonl"),
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
      session_id: "session-123", hook_event_name: "SessionEnd", cwd: directory, transcript_path: join(fixtures, "session.jsonl"),
    }), directory, "ingest");
    expect(result.code).toBe(0);
    await expect.poll(() => readFile(join(directory, "capture.log"), "utf8"), { timeout: 10_000 }).toContain("Fixture command failed.");
  });

  it("rejects invalid payloads and skips transcripts with no conversation text", async () => {
    const directory = await temporary();
    expect((await capture("{}", directory)).code).toBe(1);
    const path = join(directory, "empty.jsonl");
    await writeFile(path, '{"type":"system"}\n');
    expect((await capture(JSON.stringify({ session_id: "session-123", hook_event_name: "SessionEnd", cwd: directory, transcript_path: path }), directory)).code).toBe(0);
    await expect(readFile(join(directory, "result.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
