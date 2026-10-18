import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MAX_TRANSCRIPT_LENGTH } from "@openmembrane/core";
import { afterEach, describe, expect, it } from "vitest";
import { hookCommand, updateInstructions, updateSettings } from "../../packages/adapter-codex/src/config";
import { installAdapter } from "../../packages/adapter-codex/src/installer";
import { parseHookInput, sessionTranscript } from "../../packages/adapter-codex/src/transcript";

const directories: string[] = [];
const cli = resolve("tests", "unit", "fixtures", "claude-code", "cli.mjs");
async function temporary(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "openmembrane-codex-")));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

export function message(role: string, text: string): string {
  return JSON.stringify({ type: "response_item", payload: {
    type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
  } });
}

describe("Codex installation", () => {
  it("preserves original bytes, custom hooks and instructions across repeated installs", async () => {
    const directory = await temporary();
    const original = '{\r\n  "description": "Keep", "hooks": {"SessionEnd":[{"hooks":[{"type":"command","command":"custom"}]}]}\r\n}';
    await writeFile(join(directory, "hooks.json"), original);
    await writeFile(join(directory, "AGENTS.md"), "# Keep instructions");
    await writeFile(join(directory, "config.toml"), "model = 'custom'\n");
    const install = (enabled: boolean) => installAdapter(enabled, directory, cli, cli);
    await install(true);
    const once = await readFile(join(directory, "hooks.json"), "utf8");
    expect(JSON.parse(once).hooks.SessionEnd).toHaveLength(2);
    expect(JSON.parse(once).hooks.SessionEnd[1].hooks[0].timeout).toBe(3);
    await install(true);
    expect(await readFile(join(directory, "hooks.json"), "utf8")).toBe(once);
    await install(false);
    await install(false);
    expect(await readFile(join(directory, "hooks.json"), "utf8")).toBe(original);
    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).toBe("# Keep instructions");
    expect(await readFile(join(directory, "config.toml"), "utf8")).toBe("model = 'custom'\n");
  });

  it("removes new files, preserves subsequent edits and leaves deleted files deleted", async () => {
    const directory = await temporary();
    const install = (enabled: boolean) => installAdapter(enabled, directory, cli, cli);
    await install(true);
    await install(false);
    await expect(readFile(join(directory, "hooks.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(directory, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await install(true);
    const settings = JSON.parse(await readFile(join(directory, "hooks.json"), "utf8"));
    settings.hooks.SessionEnd[0].hooks.push({ type: "command", command: "keep" });
    await writeFile(join(directory, "hooks.json"), JSON.stringify(settings));
    await writeFile(join(directory, "AGENTS.md"), await readFile(join(directory, "AGENTS.md"), "utf8") + "\nNew text\n");
    await install(true);
    await install(false);
    expect(JSON.parse(await readFile(join(directory, "hooks.json"), "utf8")).hooks.SessionEnd[0].hooks)
      .toEqual([{ type: "command", command: "keep" }]);
    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).toContain("New text");
    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).not.toContain("openmembrane:start");
    await install(true);
    await unlink(join(directory, "AGENTS.md"));
    await install(false);
    await expect(readFile(join(directory, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes owned handlers after executable paths change and preserves unrelated groups", () => {
    const base = '{"hooks":{"Stop":[{"matcher":"custom","hooks":[]}]}}';
    const once = updateSettings(base, "old-node capture", true);
    const twice = updateSettings(once, "new-node capture", true);
    expect(JSON.parse(twice).hooks.SessionEnd).toHaveLength(1);
    expect(JSON.parse(updateSettings(twice, "new-node capture", false))).toEqual(JSON.parse(base));
    expect(updateInstructions(updateInstructions("Custom", true), true)).toBe(updateInstructions("Custom", true));
  });

  it("rejects malformed config before modifying any file", async () => {
    const directory = await temporary();
    await writeFile(join(directory, "hooks.json"), '{"hooks":[]}');
    await writeFile(join(directory, "AGENTS.md"), "Keep");
    await expect(installAdapter(true, directory, cli, cli)).rejects.toThrow();
    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).toBe("Keep");
    await expect(readFile(join(directory, "openmembrane-capture.mjs"))).rejects.toMatchObject({ code: "ENOENT" });
    for (const text of ["[]", '{"hooks":{"SessionEnd":{}}}', '{"hooks":{"SessionEnd":[{}]}}']) {
      expect(() => updateSettings(text, "capture", true)).toThrow();
    }
    expect(() => updateInstructions("<!-- openmembrane:start -->", true)).toThrow("Malformed");
  });

  it("quotes literal arguments for the actual platform shell", async () => {
    const directory = await temporary();
    const script = join(directory, "space ' & $ test.mjs");
    await writeFile(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
    const args = ["space", "'quote", "$HOME", "%PATH%", "&|<>`!"];
    const command = hookCommand([process.execPath, script, ...args]);
    const result = await new Promise<string>((accept, reject) => {
      const child = spawn(process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh",
        process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command]);
      let output = "";
      let error = "";
      child.stdout.on("data", (chunk) => { output += String(chunk); });
      child.stderr.on("data", (chunk) => { error += String(chunk); });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? accept(output) : reject(new Error(error)));
    });
    expect(JSON.parse(result)).toEqual(args);
  });
});

describe("Codex transcript capture", () => {
  it("reads rollout messages once and excludes instruction, reasoning, tool and duplicate event records", () => {
    const content = [
      '{"type":"session_meta","payload":{"id":"session"}}',
      message("system", "system instructions"), message("developer", "developer instructions"),
      message("user", "rule: Use strict TypeScript."), message("assistant", "Acknowledged."),
      '{"type":"event_msg","payload":{"type":"user_message","message":"rule: Use strict TypeScript."}}',
      '{"type":"response_item","payload":{"type":"reasoning","summary":[{"text":"private reasoning"}]}}',
      '{"type":"response_item","payload":{"type":"function_call_output","output":"private tool output"}}',
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_image","image_url":"secret"}]}}',
    ].join("\n");
    expect(sessionTranscript(content)).toBe("user:\nrule: Use strict TypeScript.\n\nassistant:\nAcknowledged.");
    expect(() => sessionTranscript("{invalid}")).toThrow("line 1");
    expect(() => sessionTranscript('{"type":"response_item","payload":{"type":"message","role":"user"}}')).toThrow("Missing");
    for (const input of [{}, { hook_event_name: "Stop" }, {
      hook_event_name: "SessionEnd", cwd: "/project", session_id: "s", transcript_path: null,
    }]) expect(() => parseHookInput(JSON.stringify(input))).toThrow("Expected");
  });

  async function capture(directory: string, transcript: string, fail = ""): Promise<{ code: number | null; stderr: string }> {
    const path = join(directory, "session.jsonl");
    await writeFile(path, transcript);
    const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    return new Promise((accept, reject) => {
      const child = spawn(process.execPath, [
        resolve("packages", "adapter-codex", "src", "capture.ts"), cli, join(directory, "capture.log"),
      ], {
        env: { ...process.env, NODE_OPTIONS: `--import=${loader}`, CAPTURE_RESULT: join(directory, "result.jsonl"), FAIL_CAPTURE: fail },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", reject);
      child.once("close", (code) => accept({ code, stderr }));
      child.stdin.end(JSON.stringify({
        hook_event_name: "SessionEnd", cwd: directory, transcript_path: path, session_id: "codex-session",
      }));
    });
  }

  it("passes stable session identity and redacts complete secrets before chunking", async () => {
    const directory = await temporary();
    const key = "-----BEGIN PRIVATE KEY-----\n" + "PRIVATE_MATERIAL".repeat(100) + "\n-----END PRIVATE KEY-----";
    const text = "x".repeat(MAX_TRANSCRIPT_LENGTH - 100) + key + "\n" + "y".repeat(MAX_TRANSCRIPT_LENGTH);
    expect(await capture(directory, message("user", text))).toEqual({ code: 0, stderr: "" });
    let calls: { args: string[]; cwd: string; input: string }[] = [];
    await expect.poll(async () => {
      try {
        calls = (await readFile(join(directory, "result.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
        return calls.length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
        throw error;
      }
    }, { timeout: 15_000 }).toBe(3);
    expect(calls[0]).toEqual({ args: ["start"], cwd: directory, input: "" });
    expect(calls.slice(1).every((call) => call.cwd === directory && call.input.length <= MAX_TRANSCRIPT_LENGTH &&
      call.args.join(" ") === "ingest --stdin --tool codex --format text --session-id codex-session")).toBe(true);
    expect(calls.slice(1).map((call) => call.input).join("")).toBe(`user:\n${text.replace(key, "[REDACTED:private_key]")}`);
  });

  it("logs background startup failures without ingesting or exposing transcript text", async () => {
    const directory = await temporary();
    expect(await capture(directory, message("user", "PRIVATE_TRANSCRIPT"), "start")).toEqual({ code: 0, stderr: "" });
    await expect.poll(async () => await readFile(join(directory, "capture.log"), "utf8"), { timeout: 15_000 }).toContain("capture failed");
    const log = await readFile(join(directory, "capture.log"), "utf8");
    expect(log).not.toContain("PRIVATE_TRANSCRIPT");
    const calls = (await readFile(join(directory, "result.jsonl"), "utf8")).trim().split("\n");
    expect(calls).toHaveLength(1);
  });
});
