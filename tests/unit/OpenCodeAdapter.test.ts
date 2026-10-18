import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, parse, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenMembraneClientError } from "@openmembrane/client";
import type { OpenMembraneClient } from "@openmembrane/client";
import { createHooks, detectProject, sessionTranscript } from "../../packages/adapter-opencode/src/plugin";
import { expectedTranscript, model, sessionId, sessionMessages } from "./fixtures/opencodeSession";
import { entry } from "./helpers";
import { ingestion } from "./protocolFixtures";

const project = { projectRoot: resolve("fixture-project"), projectId: "fixture-project" };
const idle = { event: { type: "session.idle", properties: { sessionID: sessionId } } } as const;
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function fixture() {
  const messages = vi.fn<Parameters<typeof createHooks>[0]["client"]["session"]["messages"]>()
    .mockResolvedValue({ data: structuredClone(sessionMessages), request: new Request("http://localhost/session"),
      response: new Response() });
  const log = vi.fn<Parameters<typeof createHooks>[0]["client"]["app"]["log"]>()
    .mockResolvedValue({ data: true, request: new Request("http://localhost/log"), response: new Response() });
  const daemon = {
    ingest: vi.fn<OpenMembraneClient["ingest"]>().mockResolvedValue(ingestion),
    getProjectRules: vi.fn<OpenMembraneClient["getProjectRules"]>().mockResolvedValue({
      rules: [entry({ content: "Use isolated Vitest fixtures." })], pendingCandidateCount: 0,
    }),
    getRelevantContext: vi.fn<OpenMembraneClient["getRelevantContext"]>().mockResolvedValue({
      memories: [entry({ id: "context", content: "The project uses Vitest." })], pendingCandidateCount: 0,
    }),
  };
  const host = { client: { session: { messages }, app: { log } } };
  return { host, messages, log, daemon, hooks: createHooks(host, daemon, project) };
}

describe("OpenCode reference adapter", () => {
  it("maps the OpenCode fixture to an exact ingest request without prompting", async () => {
    const { hooks, daemon, messages } = fixture();
    expect(sessionTranscript(sessionMessages)).toBe(expectedTranscript);
    await hooks.event?.(idle);
    expect(messages).toHaveBeenCalledWith({
      path: { id: sessionId }, query: { directory: project.projectRoot },
    });
    expect(daemon.ingest).toHaveBeenCalledExactlyOnceWith({
      ...project, transcript: expectedTranscript, tool: "opencode", sessionId,
    });
  });

  it("injects rules and relevant context while preserving the host prompt, including resumed sessions", async () => {
    const { hooks, daemon } = fixture();
    const output = { system: ["Host instructions"] };
    await hooks["experimental.chat.system.transform"]?.({ sessionID: sessionId, model }, output);
    expect(daemon.getProjectRules).toHaveBeenCalledExactlyOnceWith(project);
    expect(daemon.getRelevantContext).toHaveBeenCalledExactlyOnceWith({
      ...project, query: "The project must use isolated Vitest fixtures for integration tests.",
    });
    expect(output.system).toHaveLength(1);
    expect(output.system[0]).toMatch(/^Host instructions\n\nOpenMembrane project memory:/);
    expect(output.system[0]).toContain("Use isolated Vitest fixtures.");
    expect(output.system[0]).toContain("The project uses Vitest.");
    await hooks["experimental.chat.system.transform"]?.({ sessionID: sessionId, model }, { system: [] });
    expect(daemon.getProjectRules).toHaveBeenCalledTimes(2);
  });

  it("deduplicates injected memories by ID", async () => {
    const { hooks, daemon } = fixture();
    const memory = entry();
    daemon.getProjectRules.mockResolvedValue({ rules: [memory], pendingCandidateCount: 0 });
    daemon.getRelevantContext.mockResolvedValue({ memories: [memory], pendingCandidateCount: 0 });
    const output = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.({ sessionID: sessionId, model }, output);
    expect(output.system.join("\n").split(memory.content)).toHaveLength(2);
  });

  it.each([{ system: [] }, { system: ["Host prompt"] }, { system: ["Provider prefix", "Host prompt"] }])(
    "preserves system-message count when injecting into $system", async ({ system: initial }) => {
      const { hooks } = fixture();
      const output = { system: [...initial] };
      await hooks["experimental.chat.system.transform"]?.({ sessionID: sessionId, model }, output);
      expect(output.system).toHaveLength(Math.max(1, initial.length));
      for (let i = 0; i < initial.length; i++) expect(output.system[i]).toContain(initial[i]!);
      expect(output.system.at(-1)).toContain("OpenMembrane project memory:");
    },
  );

  it("ignores auxiliary model requests and unrelated events", async () => {
    const { hooks, daemon, messages } = fixture();
    await hooks["experimental.chat.system.transform"]?.({ model }, { system: [] });
    await hooks.event?.({ event: { type: "server.connected", properties: {} } });
    expect(messages).not.toHaveBeenCalled();
    expect(daemon.ingest).not.toHaveBeenCalled();
  });

  it("serializes concurrent idle events, skips unchanged snapshots, and ingests changed snapshots", async () => {
    const { hooks, daemon, messages } = fixture();
    await Promise.all([hooks.event?.(idle), hooks.event?.(idle), hooks.event?.(idle)]);
    expect(daemon.ingest).toHaveBeenCalledTimes(1);
    const changed = structuredClone(sessionMessages);
    changed[0]!.parts.push({ id: "extra", sessionID: sessionId, messageID: "msg_user", type: "text", text: "New knowledge." });
    messages.mockResolvedValue({ data: changed, request: new Request("http://localhost"), response: new Response() });
    await hooks.event?.(idle);
    expect(daemon.ingest).toHaveBeenCalledTimes(2);
    expect(daemon.ingest.mock.calls[1]![0].transcript).toContain("New knowledge.");
  });

  it("does not ingest empty sessions", async () => {
    const { hooks, daemon, messages } = fixture();
    messages.mockResolvedValue({ data: [], request: new Request("http://localhost"), response: new Response() });
    await hooks.event?.(idle);
    expect(daemon.ingest).not.toHaveBeenCalled();
  });

  it("clears the delivery digest on session deletion", async () => {
    const { hooks, daemon } = fixture();
    await hooks.event?.(idle);
    await hooks.event?.({ event: {
      type: "session.deleted", properties: { info: {
        id: sessionId, projectID: "project", directory: project.projectRoot,
        title: "Fixture", version: "1", time: { created: 1, updated: 2 },
      } },
    } });
    await hooks.event?.(idle);
    expect(daemon.ingest).toHaveBeenCalledTimes(2);
  });

  it("logs startup failures safely and retries unchanged failed transcripts on the next idle", async () => {
    const { hooks, daemon, log } = fixture();
    daemon.ingest.mockRejectedValueOnce(new OpenMembraneClientError("E_DAEMON_LAUNCH_FAILED", "Unavailable", {
      cause: new Error("private transcript and credentials"),
    }));
    await expect(hooks.event?.(idle)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith({ body: expect.objectContaining({
      level: "warn", extra: expect.objectContaining({ code: "E_DAEMON_LAUNCH_FAILED" }),
    }) });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private transcript");
    await hooks.event?.(idle);
    expect(daemon.ingest).toHaveBeenCalledTimes(2);
  });

  it("preserves the host prompt on daemon errors and falls back to stderr if logging fails", async () => {
    const { hooks, daemon, log } = fixture();
    daemon.getProjectRules.mockRejectedValue(new Error("private details"));
    log.mockRejectedValue(new Error("logging unavailable"));
    const stderr = vi.spyOn(console, "warn").mockImplementation(() => {});
    const output = { system: ["Host instructions"] };
    await expect(hooks["experimental.chat.system.transform"]?.({ sessionID: sessionId, model }, output))
      .resolves.toBeUndefined();
    expect(output.system).toEqual(["Host instructions"]);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("context retrieval failed"));
    expect(JSON.stringify(stderr.mock.calls)).not.toContain("private details");
  });

  it("logs SDK error envelopes instead of treating a failed transcript read as an empty session", async () => {
    const { hooks, daemon, messages, log } = fixture();
    messages.mockResolvedValue({
      error: { name: "NotFoundError", data: { message: "Missing session" } },
      data: undefined, request: new Request("http://localhost"), response: new Response(null, { status: 404 }),
    });
    await hooks.event?.(idle);
    expect(daemon.ingest).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("waits for active ingestion on disposal", async () => {
    const { hooks, daemon } = fixture();
    let finish = () => {};
    daemon.ingest.mockImplementation(() => new Promise((resolve) => { finish = () => resolve(ingestion); }));
    const pending = hooks.event?.(idle);
    await vi.waitFor(() => expect(daemon.ingest).toHaveBeenCalled());
    let disposed = false;
    const disposing = hooks.dispose?.().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    finish();
    await Promise.all([pending, disposing]);
    expect(disposed).toBe(true);
  });
});

describe("OpenCode project detection", () => {
  it("uses cwd and honors the explicit environment project ID", async () => {
    expect(await detectProject(project.projectRoot, {})).toEqual(project);
    expect(await detectProject(project.projectRoot, { OPENMEMBRANE_PROJECT_ID: "custom" }))
      .toEqual({ projectRoot: project.projectRoot, projectId: "custom" });
    expect(await detectProject("", {})).toEqual({ projectRoot: process.cwd(), projectId: basename(process.cwd()) });
  });

  it("supports a git origin repository name when cwd has no basename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "om-opencode-git-"));
    directories.push(dir);
    const exec = promisify(execFile);
    await exec("git", ["init", dir]);
    await exec("git", ["-C", dir, "remote", "add", "origin", "git@example.com:team/repository.git"]);
    const cwd = parse(process.cwd()).root;
    const original = process.env.GIT_DIR;
    process.env.GIT_DIR = join(dir, ".git");
    try {
      expect(await detectProject(cwd, {})).toEqual({ projectRoot: cwd, projectId: "repository" });
    } finally {
      if (original === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = original;
    }
  });
});
