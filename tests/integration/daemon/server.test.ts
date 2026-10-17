import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer, Server } from "node:http";
import { Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, parse } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenMembraneClient, OpenMembraneClientError } from "@openmembrane/client";
import type { ClientRequest } from "@openmembrane/client";
import { endpoints, errorResponseSchema, resolveDaemonPaths } from "@openmembrane/protocol";
import type { EndpointName, EndpointResponse } from "@openmembrane/protocol";
import { createOpenMembraneService, resolveProjectRef } from "@openmembrane/service";
import * as serviceModule from "@openmembrane/service";
import type { CommandRunner } from "@openmembrane/service";
import { startDaemon } from "../../../apps/daemon/src/server";
import * as privateFiles from "../../../apps/daemon/src/privateFiles";
import type { RunningDaemon } from "../../../apps/daemon/src/server";
import { readLock } from "../../../apps/daemon/src/lock";
import { createOpenMembraneContext } from "../../../apps/mcp-server/src/context";
import { sendRequest } from "../../../packages/client/src/transport";
import { candidate, entry } from "../../unit/helpers";

const directories: string[] = [];
const daemons: RunningDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close()));
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function setup(runner?: CommandRunner, transport?: "socket" | "tcp") {
  const root = await mkdtemp(join(tmpdir(), "omd-"));
  directories.push(root);
  const alpha = join(root, "alpha");
  const beta = join(root, "beta");
  await Promise.all([mkdir(alpha), mkdir(beta)]);
  const paths = { homeDir: root, runtimeDir: root };
  const daemon = await startDaemon({
    paths,
    ...(transport ? { transport } : {}),
    ...(runner ? { serviceOptions: { githubRunner: runner } } : {}),
  });
  daemons.push(daemon);
  const client = (projectRoot = alpha, env: NodeJS.ProcessEnv = {}) => new OpenMembraneClient({
    endpoint: daemon.endpoint, daemonPaths: paths, projectRoot, env,
  });
  const token = (await readFile(resolveDaemonPaths(paths).tokenPath, "utf8")).trim();
  return { root, alpha, beta, paths, daemon, client, token };
}

async function seed(projectRoot: string) {
  const service = createOpenMembraneService();
  try {
    const state = await service.projectState({ projectRoot, projectId: basename(projectRoot), storageBackend: "json" });
    await state.pendingCandidateStore.save(candidate({ projectId: basename(projectRoot), id: "approve candidate" }));
    await state.pendingCandidateStore.save(candidate({ projectId: basename(projectRoot), id: "reject-candidate" }));
    await state.pendingCandidateStore.save(candidate({
      projectId: basename(projectRoot), id: "bulk-approve", content: "Database changes must use reversible migrations.",
    }));
    await state.pendingCandidateStore.save(candidate({
      projectId: basename(projectRoot), id: "bulk-secret", sensitivity: "secret", recommendedAction: "reject",
      content: "A flagged candidate must not be approved.",
    }));
    await state.memoryStore.save(entry({
      projectId: basename(projectRoot), id: "old-memory", updatedAt: "2020-01-01T00:00:00.000Z",
    }));
  } finally {
    await service.close();
  }
}

describe("daemon HTTP protocol", { timeout: process.platform === "win32" ? 15_000 : 5000 }, () => {
  it("serves every project endpoint with schema-valid results", async () => {
    const { alpha, client } = await setup();
    await seed(alpha);
    const api = client();
    const covered = new Set<EndpointName>();
    async function call<K extends EndpointName>(
      name: K, input: ClientRequest<K>,
    ): Promise<EndpointResponse<K>> {
      covered.add(name);
      const value = await api.call(name, input);
      expect(endpoints[name].response.safeParse(value).success).toBe(true);
      return value;
    }
    expect(await call("health", {})).toEqual({});
    const saved = await call("remember", {
      content: "Use dedicated integration fixtures for the alpha subsystem.", type: "testing_rule", confidence: "high",
    });
    expect(saved.savedCount).toBe(1);
    const memoryId = saved.saved[0]!.id;
    expect((await call("ingest", { transcript: "rule: The project must run Vitest before deployment." })).savedCount).toBe(1);
    expect((await call("getProjectRules", {})).rules.length).toBeGreaterThan(0);
    expect((await call("getRelevantContext", { query: "alpha fixtures" })).memories.length).toBeGreaterThan(0);
    expect((await call("searchMemory", { query: "alpha fixtures" })).length).toBeGreaterThan(0);
    expect((await call("listMemoryCandidates", {})).length).toBe(4);
    expect((await call("approveMemoryCandidate", { candidateId: "approve candidate" })).status).toBe("active");
    expect(await call("rejectMemoryCandidate", { candidateId: "reject-candidate", reason: "Obsolete" })).toMatchObject({ rejected: true });
    const bulk = await call("approveAllCandidates", {});
    expect(bulk.approved).toHaveLength(1);
    expect(bulk.skipped).toMatchObject([{ candidateId: "bulk-secret" }]);
    expect((await call("rejectAllCandidates", {})).rejectedCount).toBe(1);
    expect((await call("updateMemory", { memoryId, content: "Use isolated integration fixtures for the alpha subsystem." })).content).toContain("isolated");
    expect((await call("reviewStaleMemories", { staleAfterMonths: 6 })).map((memory) => memory.id)).toContain("old-memory");
    expect((await call("supersedeMemory", { memoryId, reason: "Obsolete" })).status).toBe("superseded");
    const exported = await call("exportStaticMemoryFiles", { targets: ["agents"] });
    expect(exported.files[0]!.path).toBe("AGENTS.md");
    expect(await readFile(join(alpha, "AGENTS.md"), "utf8")).toContain("Vitest");
    expect((await call("getDiagnostics", {})).length).toBeGreaterThan(0);
    expect((await call("listAuditLog", {})).length).toBeGreaterThan(0);
    expect(await call("getCollaborationStatus", {})).toMatchObject({ mode: "local_private" });
    // GitHub configure is covered separately with the CommandRunner seam.
    expect([...covered].sort()).toEqual(Object.keys(endpoints).filter((name) => name !== "configureGitHubTeamMode").sort());
  });

  it("requires the token on every endpoint except data-free health", async () => {
    const { daemon, token } = await setup();
    for (const [name, definition] of Object.entries(endpoints)) {
      const response = await sendRequest({
        endpoint: daemon.endpoint, method: definition.method,
        path: definition.path.replace(":id", "id"), timeoutMs: 1000,
        ...(definition.method === "GET" ? {} : { body: "{}" }),
      });
      expect(response.status, name).toBe(name === "health" ? 200 : 401);
      if (name === "health") expect(response.value).toEqual({});
      else expect(errorResponseSchema.parse(response.value).error.code).toBe("UNAUTHORIZED");
    }
    for (const invalid of ["wrong", `${token}x`, token.slice(1)]) {
      const response = await sendRequest({
        endpoint: daemon.endpoint, method: "POST", path: "/v1/remember", body: "{}", token: invalid, timeoutMs: 1000,
      });
      expect(response.status).toBe(401);
    }
    const stop = await sendRequest({ endpoint: daemon.endpoint, method: "POST", path: "/v1/daemon/stop", timeoutMs: 1000 });
    expect(stop.status).toBe(401);
  });

  it("rejects malformed requests, invalid project roots and route ID mismatches safely", async () => {
    const { daemon, token, alpha, root, client } = await setup();
    const invalidRequests = [
      { path: "/v1/remember", body: "{" },
      { path: "/v1/remember", body: JSON.stringify({ projectRoot: "relative", content: "Do not persist invalid requests.", type: "testing_rule" }) },
      { path: "/v1/remember", body: JSON.stringify({ projectRoot: join(root, "missing"), content: "Do not persist invalid requests.", type: "testing_rule" }) },
      { path: "/v1/remember", body: JSON.stringify({ projectRoot: resolveDaemonPaths({ homeDir: root, runtimeDir: root }).tokenPath, content: "Do not persist invalid requests.", type: "testing_rule" }) },
      { path: "/v1/candidates/other/approve", body: JSON.stringify({ projectRoot: alpha, candidateId: "candidate" }) },
      { path: "/v1/candidates/%ZZ/approve", body: JSON.stringify({ projectRoot: alpha, candidateId: "candidate" }) },
    ];
    for (const input of invalidRequests) {
      const result = await sendRequest({ ...input, endpoint: daemon.endpoint, method: "POST", token, timeoutMs: 1000 });
      expect(result.status).toBe(400);
      expect(errorResponseSchema.parse(result.value).error).toMatchObject({ code: "VALIDATION_ERROR", diagnosticId: expect.any(String) });
      expect(JSON.stringify(result.value)).not.toContain(root);
    }
    const badQuery = await sendRequest({
      endpoint: daemon.endpoint, method: "GET", path: "/v1/candidates?input=no-json", token, timeoutMs: 1000,
    });
    expect(badQuery.status).toBe(400);
    const unknown = await sendRequest({ endpoint: daemon.endpoint, method: "GET", path: "/v1/unknown", token, timeoutMs: 1000 });
    expect(unknown.status).toBe(404);
    const oversized = await sendRequest({
      endpoint: daemon.endpoint, method: "POST", path: "/v1/remember", token, timeoutMs: 1000,
      body: JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) }),
    });
    expect(oversized.status).toBe(413);
    expect(errorResponseSchema.parse(oversized.value).error.code).toBe("VALIDATION_ERROR");
    await expect(client().approveMemoryCandidate({ candidateId: "missing" })).rejects.toMatchObject({
      code: "CANDIDATE_NOT_FOUND", diagnosticId: expect.any(String), origin: "daemon",
    });
    expect(await client().health()).toEqual({});
  });

  it("isolates two project directories and honors client overrides, not daemon environment", async () => {
    const { alpha, beta, root, client } = await setup();
    vi.stubEnv("OPENMEMBRANE_HOME", join(root, "daemon-storage"));
    vi.stubEnv("OPENMEMBRANE_PROJECT_ID", "daemon-project");
    vi.stubEnv("OPENMEMBRANE_STORAGE_BACKEND", "sqlite");
    const first = client(alpha);
    const second = client(beta);
    expect((await first.remember({ content: "Alpha must use isolated integration fixtures.", type: "testing_rule", confidence: "high" })).projectId).toBe("alpha");
    expect(await second.searchMemory({ query: "Alpha" })).toEqual([]);
    expect((await second.remember({ content: "Beta must deploy using its separate release pipeline.", type: "deployment_rule", confidence: "high" })).projectId).toBe("beta");
    expect(await first.searchMemory({ query: "Beta" })).toEqual([]);
    expect((await stat(join(alpha, ".openmembrane", "memories"))).isDirectory()).toBe(true);
    await expect(stat(join(root, "daemon-storage"))).rejects.toMatchObject({ code: "ENOENT" });

    const clientEnv = {
      OPENMEMBRANE_HOME: "custom-storage", OPENMEMBRANE_PROJECT_ID: "caller-project", OPENMEMBRANE_STORAGE_BACKEND: "sqlite",
    };
    const forwarded = client(alpha, clientEnv);
    const result = await forwarded.remember({ content: "Caller storage must be independent of the daemon.", type: "testing_rule", confidence: "high" });
    expect(result.projectId).toBe("caller-project");
    expect(await stat(join(alpha, "custom-storage", "openmembrane.db"))).toBeDefined();
    const resolved = resolveProjectRef({
      projectRoot: alpha, storageDir: join(alpha, clientEnv.OPENMEMBRANE_HOME), projectId: clientEnv.OPENMEMBRANE_PROJECT_ID,
    });
    expect(resolved).toEqual({ projectRoot: alpha, storageDir: join(alpha, "custom-storage"), projectId: result.projectId });
    for (const [key, value] of Object.entries(clientEnv)) vi.stubEnv(key, value);
    const legacyMcp = await createOpenMembraneContext({ projectRoot: alpha });
    try {
      expect(legacyMcp.defaultProjectId).toBe(result.projectId);
      expect(legacyMcp.storageDir).toBe(await realpath(resolved.storageDir));
    } finally {
      await legacyMcp.close();
    }
    const explicit = await forwarded.remember({
      projectId: "explicit", storageDir: join(beta, "explicit-storage"), storageBackend: "json",
      content: "Explicit request fields override forwarded client settings.", type: "testing_rule", confidence: "high",
    });
    expect(explicit.projectId).toBe("explicit");
    expect((await stat(join(beta, "explicit-storage", "memories"))).isDirectory()).toBe(true);
    expect(await first.searchMemory({ query: "Caller" })).toEqual([]);
  });

  it("shares default project identity and memory visibility across normalized root spellings", async () => {
    const { alpha, client } = await setup();
    const normal = client(alpha);
    const separator = process.platform === "win32" ? "\\" : "/";
    const aliases = [`${alpha}${separator}.`, `${alpha}${separator}..${separator}alpha`];
    const content = "Project path normalization must preserve memory visibility.";
    for (const alias of aliases) {
      expect((await client(alias).remember({
        content, type: "testing_rule", confidence: "high",
      })).projectId).toBe("alpha");
      expect((await normal.searchMemory({ query: content })).map((memory) => memory.content)).toContain(content);
      expect((await client(alias).searchMemory({ query: content })).map((memory) => memory.content)).toContain(content);
    }
    const explicit = await client(aliases[0]!).remember({
      projectId: "explicit-alias", content: "Explicit project identities override normalized defaults.",
      type: "testing_rule", confidence: "high",
    });
    expect(explicit.projectId).toBe("explicit-alias");
    expect((await normal.searchMemory({ query: "Explicit project identities" }))
      .map((memory) => memory.projectId)).not.toContain("explicit-alias");
  });

  it("requires an explicit ID for filesystem-root projects without falling back to daemon settings", async () => {
    const { root, client } = await setup();
    const api = client(parse(root).root);
    const storageDir = join(root, "root-storage");
    const input = {
      storageDir, content: "Root projects must use explicit isolated project identities.",
      type: "testing_rule" as const, confidence: "high" as const,
    };
    vi.stubEnv("OPENMEMBRANE_PROJECT_ID", "");
    await expect(api.remember(input)).rejects.toMatchObject({ code: "VALIDATION_ERROR", origin: "daemon" });
    vi.stubEnv("OPENMEMBRANE_PROJECT_ID", "daemon-project");
    await expect(api.remember(input)).rejects.toMatchObject({ code: "VALIDATION_ERROR", origin: "daemon" });
    const separator = process.platform === "win32" ? "\\" : "/";
    const rootAlias = `${parse(root).root}nonexistent-root-alias${separator}..`;
    await expect(client(rootAlias).remember(input)).rejects.toMatchObject({ code: "VALIDATION_ERROR", origin: "daemon" });
    await expect(stat(storageDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await api.remember({ ...input, projectId: "caller-root" })).projectId).toBe("caller-root");
    expect((await client(rootAlias).remember({ ...input, projectId: "caller-root" })).projectId).toBe("caller-root");
    expect((await api.searchMemory({ storageDir, projectId: "caller-root" })).map((memory) => memory.projectId))
      .toEqual(["caller-root"]);
  });

  it("supplies a credential-free environment to its default GitHub command runner", async () => {
    const factory = vi.spyOn(serviceModule, "createOpenMembraneService");
    await setup();
    const runner = factory.mock.calls[0]?.[0]?.githubRunner;
    expect(runner).toBeDefined();
    if (runner === undefined) throw new Error("The daemon must configure its GitHub command runner.");
    vi.stubEnv("GH_TOKEN", "test-token");
    vi.stubEnv("GITHUB_ENTERPRISE_TOKEN", "test-enterprise-token");
    vi.stubEnv("GH_CONFIG_DIR", "test-config");
    const result = await runner.run({
      executable: process.execPath,
      args: ["-e", "console.log(JSON.stringify({tokenPresent:!!process.env.GH_TOKEN,enterprisePresent:!!process.env.GITHUB_ENTERPRISE_TOKEN,config:process.env.GH_CONFIG_DIR}))"],
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ tokenPresent: false, enterprisePresent: false, config: "test-config" });
  });

  it("binds Windows-compatible TCP only on loopback and uses an ephemeral port", async () => {
    const { daemon, client, paths } = await setup(undefined, "tcp");
    expect(daemon.endpoint).toMatchObject({ transport: "tcp", host: "127.0.0.1", port: expect.any(Number) });
    expect(JSON.parse(await readFile(resolveDaemonPaths(paths).endpointPath, "utf8"))).toEqual(daemon.endpoint);
    expect(await client().health()).toEqual({});
    if (daemon.endpoint.transport !== "tcp") throw new Error("Expected TCP");
    expect(daemon.endpoint.port).toBeGreaterThan(0);
    const bad = { ...daemon.endpoint, host: "0.0.0.0" };
    expect(() => new OpenMembraneClient({ endpoint: bad as typeof daemon.endpoint })).toThrow();
  });

  it("serializes concurrent writers sharing JSON indexes without losing memories", async () => {
    const { client } = await setup();
    const api = client();
    const contents = [
      "All API routes must validate request payloads with Zod schemas.",
      "Frontend components must use CSS modules for isolated styling.",
      "Database schema changes must include reversible SQL migration scripts.",
      "Release artifacts must be signed before production deployments.",
    ];
    const results = await Promise.all(contents.map((content) => api.remember({
      content, type: "coding_rule", confidence: "high",
    })));
    expect(results.map((result) => result.savedCount)).toEqual([1, 1, 1, 1]);
    expect((await api.searchMemory()).map((memory) => memory.content).sort()).toEqual([...contents].sort());
  });

  it("serializes shared-store writes through symlink aliases", async () => {
    const { client, root } = await setup();
    const storage = join(root, "storage");
    const alias = join(root, "alias");
    await mkdir(storage);
    await symlink(storage, alias, process.platform === "win32" ? "junction" : "dir");
    const api = client();
    const contents = [
      "All API routes must validate request payloads with Zod schemas.",
      "Frontend components must use CSS modules for isolated styling.",
      "Database schema changes must include reversible SQL migration scripts.",
      "Release artifacts must be signed before production deployments.",
    ];
    const results = await Promise.all(contents.map((content, index) => api.remember({
      content, type: "coding_rule", confidence: "high", storageDir: join(index % 2 ? alias : storage, "nested"),
    })));
    expect(results.map((result) => result.savedCount)).toEqual([1, 1, 1, 1]);
    expect((await api.searchMemory({ storageDir: join(storage, "nested") })).map((memory) => memory.content).sort())
      .toEqual([...contents].sort());
  });

  it("normalizes symlink-parent storage paths before queueing writes to the service's store", async () => {
    const { client, root } = await setup();
    const physical = join(root, "physical");
    const leaf = join(physical, "leaf");
    const alias = join(root, "alias");
    const storage = join(root, "store");
    await mkdir(leaf, { recursive: true });
    await symlink(leaf, alias, process.platform === "win32" ? "junction" : "dir");
    const separator = process.platform === "win32" ? "\\" : "/";
    const aliasStorage = `${alias}${separator}..${separator}store`;
    const canonicalize = vi.spyOn(serviceModule, "canonicalStoragePath");
    const api = client();
    const contents = [
      "All API routes must validate request payloads with Zod schemas.",
      "Frontend components must use CSS modules for isolated styling.",
      "Database schema changes must include reversible SQL migration scripts.",
      "Release artifacts must be signed before production deployments.",
    ];
    const results = await Promise.all(contents.map((content, index) => api.remember({
      content, type: "coding_rule", confidence: "high", storageDir: index % 2 ? aliasStorage : storage,
    })));
    expect(results.map((result) => result.savedCount)).toEqual([1, 1, 1, 1]);
    expect(canonicalize.mock.calls.every(([path]) => path === storage)).toBe(true);
    expect((await api.searchMemory({ storageDir: storage })).map((memory) => memory.content).sort())
      .toEqual([...contents].sort());
    expect((await api.searchMemory({ storageDir: aliasStorage })).map((memory) => memory.content).sort())
      .toEqual([...contents].sort());
    await expect(stat(join(physical, "store"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.skipIf(process.platform !== "darwin")("serializes casing aliases on case-insensitive macOS filesystems", async (context) => {
    const { client, root } = await setup();
    const storage = join(root, "MixedCaseStorage");
    const alias = join(root, "mixedcasestorage");
    await mkdir(storage);
    try {
      await realpath(alias);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      context.skip();
      return;
    }
    const api = client();
    const contents = [
      "All API routes must validate request payloads with Zod schemas.",
      "Database schema changes must include reversible SQL migration scripts.",
    ];
    const results = await Promise.all(contents.map((content, index) => api.remember({
      content, type: "coding_rule", confidence: "high", storageDir: index ? alias : storage,
    })));
    expect(results.map((result) => result.savedCount)).toEqual([1, 1]);
    expect((await api.searchMemory({ storageDir: storage })).map((memory) => memory.content).sort()).toEqual([...contents].sort());
  });

  it("shuts down when closeIdleConnections is absent as on Node 18.0 and 18.1", async () => {
    const { daemon, paths, client } = await setup();
    expect(await client().health()).toEqual({});
    const descriptor = Object.getOwnPropertyDescriptor(Server.prototype, "closeIdleConnections");
    const closeDescriptor = Object.getOwnPropertyDescriptor(Server.prototype, "close");
    Object.defineProperty(Server.prototype, "closeIdleConnections", { value: undefined, configurable: true });
    // Modern HTTP close() invokes closeIdleConnections internally; emulate the older net close path.
    Object.defineProperty(Server.prototype, "close", { value: NetServer.prototype.close, configurable: true });
    try {
      await daemon.close();
      await daemon.closed;
      expect(await readLock(resolveDaemonPaths(paths).runDir)).toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(Server.prototype, "closeIdleConnections", descriptor);
      else Reflect.deleteProperty(Server.prototype, "closeIdleConnections");
      if (closeDescriptor) Object.defineProperty(Server.prototype, "close", closeDescriptor);
      else Reflect.deleteProperty(Server.prototype, "close");
    }
  });

  it("drains requests and closes stores when recovery-guard creation fails without deleting unprotected discovery", async () => {
    const service = createOpenMembraneService();
    const closeService = vi.spyOn(service, "close");
    vi.spyOn(serviceModule, "createOpenMembraneService").mockReturnValueOnce(service);
    const { daemon, paths, client, root } = await setup();
    daemons.splice(daemons.indexOf(daemon), 1);
    const resolved = resolveDaemonPaths(paths);
    const token = await readFile(resolved.tokenPath, "utf8");
    const endpoint = await readFile(resolved.endpointPath, "utf8");
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const forProject = service.forProject.bind(service);
    vi.spyOn(service, "forProject").mockImplementation(async (ref) => {
      entered();
      await gate;
      return forProject(ref);
    });
    const request = client().remember({
      content: "Shutdown must drain requests even when guard creation fails.",
      type: "testing_rule", confidence: "high",
    });
    await pending;
    const failure = Object.assign(new Error("Sensitive guard creation failure"), { code: "ENOSPC" });
    let guardFailed: () => void = () => undefined;
    const guardAttempt = new Promise<void>((resolve) => { guardFailed = resolve; });
    const write = privateFiles.writePrivateFile;
    const writeSpy = vi.spyOn(privateFiles, "writePrivateFile").mockImplementation(async (path, content) => {
      if (basename(path).startsWith("lock-")) {
        guardFailed();
        throw failure;
      }
      await write(path, content);
    });
    const closed = expect(daemon.closed).rejects.toMatchObject({ code: "DAEMON_CLEANUP_ERROR" });
    const shutdown = daemon.close();
    const rejected = expect(shutdown).rejects.toMatchObject({ code: "DAEMON_CLEANUP_ERROR" });
    try {
      await guardAttempt;
      expect(closeService).not.toHaveBeenCalled();
    } finally {
      release();
    }
    expect((await request).savedCount).toBe(1);
    await rejected;
    await closed;
    expect(closeService).toHaveBeenCalledOnce();
    await expect(sendRequest({
      endpoint: daemon.endpoint, method: "GET", path: "/v1/health", timeoutMs: 1000,
    })).rejects.toMatchObject({ code: "E_DAEMON_NOT_RUNNING" });
    expect(await readLock(resolved.runDir)).toBeUndefined();
    expect(await readFile(resolved.tokenPath, "utf8")).toBe(token);
    expect(await readFile(resolved.endpointPath, "utf8")).toBe(endpoint);
    await expect(daemon.close()).rejects.toMatchObject({ code: "DAEMON_CLEANUP_ERROR" });
    const logs = await readFile(join(root, ".openmembrane", "logs", "daemon.log"), "utf8");
    expect(logs).toContain('"event":"shutdown_failed"');
    expect(logs).toContain('"code":"DAEMON_CLEANUP_ERROR"');
    expect(logs).not.toContain(failure.message);
    writeSpy.mockRestore();
    const replacement = await startDaemon({ paths });
    daemons.push(replacement);
    expect((await sendRequest({
      endpoint: replacement.endpoint, method: "GET", path: "/v1/health", timeoutMs: 1000,
    })).status).toBe(200);
  }, 15_000);

  it("closes the service and releases its live-process lock when the server factory throws", async () => {
    const { daemon: initial, paths } = await setup();
    await initial.close();
    const service = createOpenMembraneService();
    const closeService = vi.spyOn(service, "close");
    const factory = vi.spyOn(serviceModule, "createOpenMembraneService").mockReturnValueOnce(service);
    const failure = new Error("Sensitive server factory failure");
    await expect(startDaemon({
      paths,
      serverFactory() { throw failure; },
    })).rejects.toBe(failure);
    expect(factory).toHaveBeenCalledOnce();
    expect(closeService).toHaveBeenCalledOnce();
    const resolved = resolveDaemonPaths(paths);
    expect(await readLock(resolved.runDir)).toBeUndefined();
    for (const path of [resolved.tokenPath, resolved.endpointPath,
      ...(process.platform === "win32" ? [] : [resolved.socketPath])]) {
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
    const replacement = await startDaemon({ paths });
    daemons.push(replacement);
    expect((await sendRequest({
      endpoint: replacement.endpoint, method: "GET", path: "/v1/health", timeoutMs: 1000,
    })).status).toBe(200);
  });

  it("releases its live-process lock when service initialization throws", async () => {
    const { daemon: initial, paths } = await setup();
    await initial.close();
    const failure = new Error("Sensitive service initialization failure");
    vi.spyOn(serviceModule, "createOpenMembraneService").mockImplementationOnce(() => { throw failure; });
    await expect(startDaemon({ paths })).rejects.toBe(failure);
    expect(await readLock(resolveDaemonPaths(paths).runDir)).toBeUndefined();
    const replacement = await startDaemon({ paths });
    daemons.push(replacement);
  });

  it("rejects closed after listener errors, logs a safe diagnostic, and cleans up discovery", async () => {
    const { daemon: initial, paths, root } = await setup();
    await initial.close();
    let listener: Server | undefined;
    const daemon = await startDaemon({
      paths,
      serverFactory(handler) {
        listener = createServer(handler);
        return listener;
      },
    });
    const closed = expect(daemon.closed).rejects.toMatchObject({ code: "DAEMON_LISTENER_ERROR" });
    listener!.emit("error", new Error("Sensitive listener failure detail"));
    await closed;
    await expect(daemon.close()).rejects.toMatchObject({ code: "DAEMON_LISTENER_ERROR" });
    expect(await readLock(resolveDaemonPaths(paths).runDir)).toBeUndefined();
    await expect(stat(resolveDaemonPaths(paths).tokenPath)).rejects.toMatchObject({ code: "ENOENT" });
    const logs = (await readFile(join(root, ".openmembrane", "logs", "daemon.log"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { event: string; code?: string; diagnosticId?: string });
    expect(logs.at(-1)).toMatchObject({
      event: "listener_failed", code: "DAEMON_LISTENER_ERROR", diagnosticId: expect.any(String),
    });
    expect(JSON.stringify(logs)).not.toContain("Sensitive listener failure detail");
  });

  it.each(["before listening", "after ready", "during publication"])(
    "cleans up listener errors %s during startup and allows a clean restart",
    async (phase) => {
      const { daemon: initial, paths, root } = await setup();
      await initial.close();
      let listener: Server | undefined;
      const failure = new Error("Sensitive startup listener failure");
      if (phase === "during publication") {
        const replace = privateFiles.replacePrivateFile;
        vi.spyOn(privateFiles, "replacePrivateFile").mockImplementationOnce(async (source, destination) => {
          listener!.emit("error", failure);
          await replace(source, destination);
        });
      }
      await expect(startDaemon({
        paths,
        serverFactory(handler) {
          const server = createServer(handler);
          listener = server;
          if (phase === "before listening") {
            vi.spyOn(server, "listen").mockImplementation(() => {
              queueMicrotask(() => server.emit("error", failure));
              return server;
            });
          } else if (phase === "after ready") {
            server.once("listening", () => { queueMicrotask(() => server.emit("error", failure)); });
          }
          return server;
        },
      })).rejects.toMatchObject({ code: "DAEMON_LISTENER_ERROR", cause: failure });
      expect(listener!.listening).toBe(false);
      const resolved = resolveDaemonPaths(paths);
      expect(await readLock(resolved.runDir)).toBeUndefined();
      for (const path of [resolved.tokenPath, resolved.endpointPath,
        ...(process.platform === "win32" ? [] : [resolved.socketPath])]) {
        await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
      }
      const log = await readFile(join(root, ".openmembrane", "logs", "daemon.log"), "utf8");
      expect(log).toContain('"event":"listener_failed"');
      expect(log).toContain('"code":"DAEMON_LISTENER_ERROR"');
      expect(log).not.toContain(failure.message);
      const replacement = await startDaemon({ paths });
      daemons.push(replacement);
    }, 15_000,
  );

  it("recovers a stale lock whose PID belongs to a live unrelated process", async () => {
    const { daemon, paths } = await setup();
    await daemon.close();
    await writeFile(join(resolveDaemonPaths(paths).runDir, "daemon.lock"), JSON.stringify({
      pid: process.pid, instanceId: randomUUID(), endpoint: daemon.endpoint,
    }));
    const replacement = await startDaemon({ paths });
    daemons.push(replacement);
    const token = await readFile(resolveDaemonPaths(paths).tokenPath, "utf8");
    const response = await sendRequest({
      endpoint: replacement.endpoint, method: "GET", path: "/v1/daemon/identity", token, timeoutMs: 1000,
    });
    expect(response.value).toEqual({ instanceId: (await readLock(resolveDaemonPaths(paths).runDir))!.instanceId });
    const denied = await sendRequest({
      endpoint: replacement.endpoint, method: "GET", path: "/v1/daemon/identity", timeoutMs: 1000,
    });
    expect(denied.status).toBe(401);
  });

  it("blocks replacement until listener shutdown and discovery cleanup finish", async () => {
    const { daemon: initial, paths } = await setup();
    await initial.close();
    let listenerClosed: () => void = () => undefined;
    let releaseClose: () => void = () => undefined;
    const stoppedListening = new Promise<void>((resolve) => { listenerClosed = resolve; });
    const finishClose = new Promise<void>((resolve) => { releaseClose = resolve; });
    const daemon = await startDaemon({
      paths,
      serverFactory(handler) {
        const server = createServer(handler);
        const originalClose = server.close.bind(server);
        server.close = (callback) => originalClose((error) => {
          listenerClosed();
          void finishClose.then(() => callback?.(error));
        });
        return server;
      },
    });
    daemons.push(daemon);
    const resolved = resolveDaemonPaths(paths);
    const token = await readFile(resolved.tokenPath, "utf8");
    const shutdown = daemon.close();
    try {
      await stoppedListening;
      await expect(startDaemon({ paths })).rejects.toMatchObject({ code: "DAEMON_RECOVERING" });
      expect(await readFile(resolved.tokenPath, "utf8")).toBe(token);
      expect(await readLock(resolved.runDir)).toBeDefined();
    } finally {
      releaseClose();
      await shutdown;
    }
    const replacement = await startDaemon({ paths });
    daemons.push(replacement);
    const replacementToken = await readFile(resolved.tokenPath, "utf8");
    await daemon.close();
    expect(await readFile(resolved.tokenPath, "utf8")).toBe(replacementToken);
    expect((await sendRequest({
      endpoint: replacement.endpoint, method: "GET", path: "/v1/daemon/identity", token: replacementToken,
      timeoutMs: 1000,
    })).value).toEqual({ instanceId: (await readLock(resolved.runDir))!.instanceId });
  }, 15_000);

  it("never reclaims a slow live daemon and treats legacy identity timeouts as indeterminate", async () => {
    const { daemon: initial, paths } = await setup();
    await initial.close();
    const daemon = await startDaemon({
      paths,
      serverFactory(handler) {
        return createServer((req, res) => {
          if (req.url === "/v1/daemon/identity") req.resume();
          else handler(req, res);
        });
      },
    });
    daemons.push(daemon);
    const resolved = resolveDaemonPaths(paths);
    const current = (await readLock(resolved.runDir))!;
    await expect(startDaemon({ paths })).rejects.toMatchObject({ code: "DAEMON_ALREADY_RUNNING" });
    const { processIdentity: _identity, ...legacy } = current;
    await writeFile(join(resolved.runDir, "daemon.lock"), JSON.stringify(legacy));
    await expect(startDaemon({ paths })).rejects.toMatchObject({ code: "DAEMON_OWNERSHIP_UNCERTAIN" });
    expect(await readLock(resolved.runDir)).toEqual(legacy);
    expect((await sendRequest({
      endpoint: daemon.endpoint, method: "GET", path: "/v1/health", timeoutMs: 1000,
    })).status).toBe(200);
  }, 15_000);

  it("rejects stop requests for a previous instance even with the replacement's valid token", async () => {
    const { daemon: initial, paths } = await setup();
    const previous = (await readLock(resolveDaemonPaths(paths).runDir))!;
    await initial.close();
    const replacement = await startDaemon({ paths });
    daemons.push(replacement);
    const current = (await readLock(resolveDaemonPaths(paths).runDir))!;
    const token = await readFile(resolveDaemonPaths(paths).tokenPath, "utf8");
    const stop = (instanceId?: string) => sendRequest({
      endpoint: replacement.endpoint, method: "POST", path: "/v1/daemon/stop", token, timeoutMs: 1000,
      body: JSON.stringify(instanceId === undefined ? {} : { instanceId }),
    });
    expect((await stop()).status).toBe(400);
    const stale = await stop(previous.instanceId);
    expect(stale.status).toBe(409);
    expect(errorResponseSchema.parse(stale.value).error.code).toBe("DAEMON_INSTANCE_MISMATCH");
    expect(await readLock(resolveDaemonPaths(paths).runDir)).toEqual(current);
    expect((await stop(current.instanceId)).status).toBe(200);
    await replacement.closed;
    expect(await readLock(resolveDaemonPaths(paths).runDir)).toBeUndefined();
  }, 15_000);

  it("creates owner-only token/run files and logs no tokens or request content", async () => {
    const { token, paths, root, client, daemon } = await setup();
    const resolved = resolveDaemonPaths(paths);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    if (process.platform !== "win32") {
      expect((await stat(resolved.runDir)).mode & 0o777).toBe(0o700);
      expect((await stat(resolved.tokenPath)).mode & 0o777).toBe(0o600);
      if (daemon.endpoint.transport === "socket") expect((await stat(daemon.endpoint.socketPath)).mode & 0o777).toBe(0o600);
    } else {
      const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "$acl = Get-Acl -LiteralPath $env:OPENMEMBRANE_TEST_TOKEN; $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if (@($acl.Access | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid }).Count -ne 0) { exit 1 }; if (-not $acl.AreAccessRulesProtected) { Write-Output 'inherited-private-directory' } else { Write-Output 'protected' }"],
        { env: { ...process.env, OPENMEMBRANE_TEST_TOKEN: resolved.tokenPath }, windowsHide: true });
      expect(stdout).toMatch(/protected|inherited-private-directory/);
    }
    await client().remember({ content: "This unique request text must never be recorded in daemon logs.", type: "testing_rule", confidence: "high" });
    await expect(client().updateMemory({ memoryId: "missing" })).rejects.toBeInstanceOf(OpenMembraneClientError);
    const logs = await readFile(join(root, ".openmembrane", "logs", "daemon.log"), "utf8");
    expect(logs).toContain("request_failed");
    expect(logs).not.toContain(token);
    expect(logs).not.toContain("unique request text");
    expect(logs).not.toContain(root);
  });

  it("refuses a live lock, recovers stale locks, and removes discovery files on shutdown", async () => {
    const { daemon, paths, token } = await setup();
    await expect(startDaemon({ paths })).rejects.toThrow("already running");
    expect((await readLock(resolveDaemonPaths(paths).runDir))?.pid).toBe(process.pid);
    expect((await readFile(resolveDaemonPaths(paths).tokenPath, "utf8")).trim()).toBe(token);
    await daemon.close();
    await expect(stat(resolveDaemonPaths(paths).tokenPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(resolveDaemonPaths(paths).endpointPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readLock(resolveDaemonPaths(paths).runDir)).toBeUndefined();
    const staleLock = JSON.stringify({
      pid: 2147483647, instanceId: randomUUID(), endpoint: daemon.endpoint,
    });
    await writeFile(join(resolveDaemonPaths(paths).runDir, "daemon.lock"), staleLock);
    const recoveryPath = `recovery-${createHash("sha256").update(staleLock).digest("hex")}`;
    await writeFile(join(resolveDaemonPaths(paths).runDir, recoveryPath), JSON.stringify({
      pid: 2147483647, instanceId: randomUUID(), endpoint: null,
    }));
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => startDaemon({ paths })));
    const winners = attempts.filter((result) => result.status === "fulfilled");
    daemons.push(...winners.map((result) => result.value));
    expect(winners).toHaveLength(1);
    expect((await readLock(resolveDaemonPaths(paths).runDir))?.pid).toBe(process.pid);
    expect((await readFile(resolveDaemonPaths(paths).tokenPath, "utf8")).trim()).not.toBe(token);
  }, 15_000);
});
