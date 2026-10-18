import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { resolveDaemonPaths } from "@openmembrane/protocol";
import { readLock } from "../../../apps/daemon/src/lock";
import { sendRequest } from "../../../packages/client/src/transport";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { OpenMembraneClient } from "@openmembrane/client";
import { createStores } from "@openmembrane/storage";
import { candidate } from "../../unit/helpers";

const exec = promisify(execFile);
const entry = resolve("apps", "mcp-server", "dist", "index.js");
const homes: string[] = [];
const environments: NodeJS.ProcessEnv[] = [];

beforeAll(async () => {
  await exec(process.execPath, [resolve("node_modules", "tsup", "dist", "cli-default.js")], {
    cwd: resolve("apps", "mcp-server"), windowsHide: true,
  });
}, 30_000);

afterEach(async () => {
  for (const env of environments.splice(0)) {
    await exec(process.execPath, [entry, "stop"], { env, windowsHide: true });
  }
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), "oml-"));
  homes.push(home);
  const project = join(home, "project");
  await mkdir(project);
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, XDG_RUNTIME_DIR: home,
    OPENMEMBRANE_HOME: join(home, "client-storage"), OPENMEMBRANE_PROJECT_ID: "client-project",
    OPENMEMBRANE_EXTRACTION_PROVIDER: "mock", OPENMEMBRANE_EXTRACTION_ENABLED: "false",
  };
  environments.push(env);
  const cli = async (command: string) => {
    try {
      return await exec(process.execPath, [entry, command], { cwd: project, env, windowsHide: true });
    } catch (error) {
      if (error instanceof Error) error.message += `\nSafe daemon diagnostics:\n${await diagnosticLog(home)}`;
      throw error;
    }
  };
  return { home, env, cli, project };
}

async function diagnosticLog(home: string): Promise<string> {
  try {
    return await readFile(join(home, ".openmembrane", "logs", "daemon.log"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "No daemon log was created.";
    throw error;
  }
}

async function waitForDaemon(home: string, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Daemon exited before readiness (${child.exitCode ?? child.signalCode}).\n${await diagnosticLog(home)}`);
    }
    const lock = await readLock(resolveDaemonPaths({ homeDir: home, runtimeDir: home }).runDir);
    if (lock?.endpoint) {
      const result = await sendRequest({ endpoint: lock.endpoint, method: "GET", path: "/v1/health", timeoutMs: 1000 });
      if (result.status === 200) return;
    }
    await delay(50);
  }
  throw new Error(`Daemon did not become ready.\n${await diagnosticLog(home)}`);
}

describe("packaged openmembrane lifecycle", () => {
  it("starts a detached daemon, reports status, refuses a second serve, and stops gracefully", async () => {
    const { cli, home } = await setup();
    await expect(cli("status")).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("not running") });
    expect((await cli("start")).stdout).toContain("started");
    expect((await cli("status")).stdout).toContain("is running");
    expect((await cli("start")).stdout).toContain("already running");
    await expect(cli("serve")).rejects.toMatchObject({ code: 1 });
    const before = await readLock(resolveDaemonPaths({ homeDir: home, runtimeDir: home }).runDir);
    expect(before?.pid).not.toBe(process.pid);
    expect((await cli("stop")).stdout).toContain("stopped");
    expect(await readLock(resolveDaemonPaths({ homeDir: home, runtimeDir: home }).runDir)).toBeUndefined();
    await expect(cli("status")).rejects.toMatchObject({ code: 1 });
  }, 30_000);

  it("runs serve in the foreground and responds to authenticated shutdown", async () => {
    const { home, env, project, cli } = await setup();
    const child = spawn(process.execPath, [entry, "serve"], { cwd: project, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const exit = once(child, "exit");
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    try {
      await waitForDaemon(home, child);
      expect(child.exitCode).toBeNull();
      expect((await cli("stop")).stdout).toContain("stopped");
      expect((await exit)[0]).toBe(0);
      expect(output).toContain("daemon is running");
    } finally {
      if (child.exitCode === null) child.kill();
    }
  }, 30_000);

  it("recovers a recycled live PID through detached start without stopping that process", async () => {
    const { cli, home } = await setup();
    await cli("start");
    const paths = resolveDaemonPaths({ homeDir: home, runtimeDir: home });
    const previous = (await readLock(paths.runDir))!;
    await cli("stop");
    await writeFile(join(paths.runDir, "daemon.lock"), JSON.stringify({
      ...previous, pid: process.pid, instanceId: randomUUID(),
    }));
    await expect(cli("status")).rejects.toMatchObject({ code: 1 });
    expect((await cli("stop")).stdout).toContain("not running");
    expect((await cli("start")).stdout).toContain("started");
    expect((await cli("status")).stdout).toContain("is running");
    expect((await readLock(paths.runDir))?.instanceId).not.toBe(previous.instanceId);
    expect((await cli("stop")).stdout).toContain("stopped");
  }, 30_000);

  it.each(["{", JSON.stringify({ pid: 2147483647 })])("recovers malformed stale locks via detached start: %s", async (content) => {
    const { cli, home } = await setup();
    const paths = resolveDaemonPaths({ homeDir: home, runtimeDir: home });
    await mkdir(paths.runDir, { recursive: true });
    const lockPath = join(paths.runDir, "daemon.lock");
    await writeFile(lockPath, content);
    const stale = new Date(Date.now() - 20_000);
    await utimes(lockPath, stale, stale);
    await expect(cli("status")).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("not running") });
    expect((await cli("start")).stdout).toContain("started");
    expect((await cli("status")).stdout).toContain("is running");
    expect((await cli("stop")).stdout).toContain("stopped");
    expect(await readLock(paths.runDir)).toBeUndefined();
  }, 30_000);

  it("preserves the grace period for a fresh malformed lock during detached start", async () => {
    const { cli, home } = await setup();
    const paths = resolveDaemonPaths({ homeDir: home, runtimeDir: home });
    await mkdir(paths.runDir, { recursive: true });
    const lockPath = join(paths.runDir, "daemon.lock");
    await writeFile(lockPath, "{");
    try {
      await expect(cli("start")).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("startup failed") });
      expect(await readFile(lockPath, "utf8")).toBe("{");
    } finally {
      await rm(lockPath);
    }
  }, 30_000);

  it.skipIf(process.platform === "win32")("handles SIGTERM with graceful cleanup", async () => {
    const { home, env, project } = await setup();
    const child = spawn(process.execPath, [entry, "serve"], { cwd: project, env, stdio: "ignore" });
    const exit = once(child, "exit");
    try {
      await waitForDaemon(home, child);
      child.kill("SIGTERM");
      expect((await exit)[0]).toBe(0);
      expect(await readLock(resolveDaemonPaths({ homeDir: home, runtimeDir: home }).runDir)).toBeUndefined();
    } finally {
      if (child.exitCode === null) child.kill();
    }
  }, 30_000);

  it.each([{ args: [] }, { args: ["mcp"] }])("preserves MCP stdio for $args", async ({ args }) => {
    const { env, project, home } = await setup();
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry, ...args], env, cwd: project, stderr: "pipe" });
    const client = new Client({ name: "daemon-compatibility-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "remember", "get_project_rules", "get_relevant_context", "search_memory",
        "list_memory_candidates", "approve_memory_candidate", "reject_memory_candidate",
      ].sort());
      expect(await readLock(resolveDaemonPaths({ homeDir: home, runtimeDir: home }).runDir)).toBeUndefined();
    } finally {
      await client.close();
    }
    const logs = join(home, ".openmembrane", "logs", "daemon.log");
    await expect(readFile(logs, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it.each([
    { runtime: "packaged", entryArgs: [entry] },
    { runtime: "source", entryArgs: [
      "--import", pathToFileURL(resolve("node_modules", "tsx", "dist", "loader.mjs")).href,
      resolve("apps", "mcp-server", "src", "index.ts"),
    ] },
  ])("auto-starts the $runtime daemon on the first stdio tool call and reuses it across all seven tools and MCP sessions", async ({ entryArgs }) => {
    const { env, project, home, cli } = await setup();
    const stores = await createStores({ backend: "json", baseDir: env.OPENMEMBRANE_HOME });
    try {
      await stores.pendingCandidateStore.save(candidate({ id: "approve candidate", projectId: "client-project" }));
      await stores.pendingCandidateStore.save(candidate({ id: "reject-candidate", projectId: "client-project" }));
    } finally {
      await stores.close?.();
    }
    const paths = resolveDaemonPaths({ homeDir: home, runtimeDir: home });
    const transport = new StdioClientTransport({ command: process.execPath, args: [...entryArgs, "mcp"], env, cwd: project, stderr: "pipe" });
    const client = new Client({ name: "thin-mcp-integration", version: "1.0.0" });
    const call = async (name: string, input: Record<string, unknown> = {}) => {
      const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: input }));
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      const block = result.content[0];
      if (block?.type !== "text") throw new Error("Expected JSON tool content.");
      return JSON.parse(block.text);
    };
    try {
      await client.connect(transport);
      await client.listTools();
      expect(await readLock(paths.runDir)).toBeUndefined();
      expect(await call("get_project_rules")).toMatchObject({ rules: [], pendingCandidateCount: 2 });
      const first = (await readLock(paths.runDir))!;
      expect(first.pid).not.toBe(process.pid);
      expect((await cli("status")).stdout).toContain("is running");
      expect(await call("remember", {
        content: "Integration fixtures must use isolated project directories.", type: "testing_rule", confidence: "high",
      })).toMatchObject({ projectId: "client-project", savedCount: 1 });
      expect(await call("get_relevant_context", { query: "isolated project directories" })).toMatchObject({
        memories: [expect.objectContaining({ content: "Integration fixtures must use isolated project directories." })],
      });
      expect(await call("search_memory", { query: "isolated" })).toHaveLength(1);
      expect(await call("list_memory_candidates")).toHaveLength(2);
      expect(await call("approve_memory_candidate", { candidateId: "approve candidate" })).toMatchObject({ projectId: "client-project", status: "active" });
      expect(await call("reject_memory_candidate", { candidateId: "reject-candidate", reason: "Obsolete" })).toMatchObject({ rejected: true });
      expect(await call("list_memory_candidates")).toEqual([]);
      const failure = await client.callTool({ name: "approve_memory_candidate", arguments: { candidateId: "missing" } });
      expect(failure.isError).toBe(true);
      expect(failure.content).toEqual([expect.objectContaining({ text: expect.stringContaining("diagnosticId") })]);
      const failed = CallToolResultSchema.parse(failure).content[0];
      if (failed?.type !== "text") throw new Error("Expected JSON error content.");
      const envelope = JSON.parse(failed.text);
      expect(envelope.error).toMatchObject({ code: "CANDIDATE_NOT_FOUND", diagnosticId: expect.stringMatching(/^diag_/) });
      expect(await diagnosticLog(home)).toContain(envelope.error.diagnosticId);
      const daemon = new OpenMembraneClient({ daemonPaths: { homeDir: home, runtimeDir: home }, projectRoot: project, env });
      expect(await daemon.getDiagnostics({ code: "CANDIDATE_NOT_FOUND" })).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: envelope.error.diagnosticId, projectId: "client-project", operation: "approveMemoryCandidate", source: "daemon" }),
      ]));
      expect(await daemon.searchMemory({ query: "isolated" })).toHaveLength(1);
      expect((await readLock(paths.runDir))?.instanceId).toBe(first.instanceId);
      await client.close();
      const second = new Client({ name: "second-mcp-session", version: "1.0.0" });
      try {
        await second.connect(new StdioClientTransport({ command: process.execPath, args: entryArgs, env, cwd: project, stderr: "pipe" }));
        expect((await second.callTool({ name: "get_project_rules", arguments: {} })).isError).not.toBe(true);
        expect((await readLock(paths.runDir))?.instanceId).toBe(first.instanceId);
      } finally {
        await second.close();
      }
    } finally {
      await client.close();
    }
  }, 30_000);
});
