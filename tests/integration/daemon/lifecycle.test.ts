import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveDaemonPaths } from "@openmembrane/protocol";
import { readLock } from "../../../apps/daemon/src/lock";
import { sendRequest } from "../../../packages/client/src/transport";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";

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
  const cli = (command: string) => exec(process.execPath, [entry, command], { cwd: project, env, windowsHide: true });
  return { home, env, cli, project };
}

async function waitForDaemon(home: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const lock = await readLock(resolveDaemonPaths({ homeDir: home, runtimeDir: home }).runDir);
    if (lock?.endpoint) {
      const result = await sendRequest({ endpoint: lock.endpoint, method: "GET", path: "/v1/health", timeoutMs: 1000 });
      if (result.status === 200) return;
    }
    await delay(50);
  }
  throw new Error("Daemon did not become ready.");
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
      await waitForDaemon(home);
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
      await waitForDaemon(home);
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
      expect(tools.tools.map((tool) => tool.name)).toContain("remember");
      expect(await readLock(resolveDaemonPaths({ homeDir: home, runtimeDir: home }).runDir)).toBeUndefined();
    } finally {
      await client.close();
    }
    const logs = join(home, ".openmembrane", "logs", "daemon.log");
    await expect(readFile(logs, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);
});
