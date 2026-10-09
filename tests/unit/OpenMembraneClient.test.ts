import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  E_DAEMON_NOT_RUNNING, loadDaemonToken, OpenMembraneClient, resolveDaemonEndpoint, resolveDaemonPaths,
} from "@openmembrane/client";
import type { DaemonEndpoint, DaemonPathOptions, EndpointName } from "@openmembrane/protocol";
import { endpoints } from "@openmembrane/protocol";
import { protocolFixtures } from "./protocolFixtures";

interface RecordedRequest {
  method: string | undefined;
  path: string;
  input: Record<string, unknown>;
  authorization: string | undefined;
  body: string;
}

describe("OpenMembraneClient with a local HTTP server", () => {
  let home: string;
  let daemonPaths: DaemonPathOptions;
  let server: Server;
  let endpoint: DaemonEndpoint;
  let records: RecordedRequest[];
  let respond: (req: IncomingMessage, res: ServerResponse) => void;

  async function listen(): Promise<void> {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolveListen();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected loopback address.");
    endpoint = { transport: "tcp", host: "127.0.0.1", port: address.port };
  }

  async function close(): Promise<void> {
    if (!server.listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "openmembrane-client-"));
    daemonPaths = { homeDir: home, runtimeDir: "" };
    const paths = resolveDaemonPaths(daemonPaths);
    await mkdir(paths.runDir, { recursive: true });
    await writeFile(paths.tokenPath, "test-token\n", { mode: 0o600 });
    records = [];
    respond = (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end("{}");
    };
    server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => { body += chunk; });
      req.on("end", () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        records.push({
          method: req.method, path: url.pathname,
          input: JSON.parse(body || url.searchParams.get("input") || "{}"),
          authorization: req.headers.authorization, body,
        });
        respond(req, res);
      });
    });
    await listen();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await close();
    await rm(home, { recursive: true, force: true });
  });

  for (const name of Object.keys(endpoints) as EndpointName[]) {
    it(`sends validated context, auth and wire data for ${name}`, async () => {
      const fixture = protocolFixtures[name];
      respond = (_req, res) => res.end(JSON.stringify(fixture.response));
      vi.stubEnv("OPENMEMBRANE_HOME", resolve(home, "store"));
      vi.stubEnv("OPENMEMBRANE_PROJECT_ID", "caller-project");
      vi.stubEnv("OPENMEMBRANE_STORAGE_BACKEND", "sqlite");
      const client = new OpenMembraneClient({ endpoint, daemonPaths });
      const { projectRoot: _root, projectId: _id, storageDir: _dir, storageBackend: _backend, ...input } = fixture.request as Record<string, unknown>;
      const result = await client.call(name, input);
      expect(result).toEqual(fixture.response);
      expect(records).toHaveLength(1);
      const definition = endpoints[name];
      let path: string = definition.path;
      if ("idField" in definition) path = path.replace(":id", encodeURIComponent(String(input[definition.idField])));
      expect(records[0]?.path).toBe(path);
      expect(records[0]?.method).toBe(definition.method);
      if (definition.projectScoped) {
        expect(records[0]?.input).toEqual({
          ...input, projectRoot: process.cwd(), storageDir: resolve(home, "store"), projectId: "caller-project", storageBackend: "sqlite",
        });
        expect(records[0]?.authorization).toBe("Bearer test-token");
      } else {
        expect(records[0]?.input).toEqual({});
        expect(records[0]?.authorization).toBeUndefined();
      }
      expect(records[0]?.body === "").toBe(definition.method === "GET");
    });
  }

  it("supports explicit per-call project overrides and URL-encodes path IDs", async () => {
    respond = (_req, res) => res.end(JSON.stringify(protocolFixtures.approveMemoryCandidate.response));
    const client = new OpenMembraneClient({
      endpoint, daemonPaths, projectRoot: home,
      env: { OPENMEMBRANE_HOME: "store", OPENMEMBRANE_PROJECT_ID: "env-id", OPENMEMBRANE_STORAGE_BACKEND: "json" },
    });
    const otherRoot = resolve(home, "other");
    await client.approveMemoryCandidate({
      projectRoot: otherRoot, projectId: "explicit-id", storageBackend: "sqlite", candidateId: "cand /?+#",
    });
    expect(records[0]?.path).toBe("/v1/candidates/cand%20%2F%3F%2B%23/approve");
    expect(records[0]?.input).toMatchObject({
      projectRoot: otherRoot, projectId: "explicit-id", storageDir: resolve(otherRoot, "store"), storageBackend: "sqlite",
    });
  });

  it("does not invent storage or project overrides when the environment is empty", async () => {
    respond = (_req, res) => res.end("[]");
    const client = new OpenMembraneClient({ endpoint, daemonPaths, env: {} });
    await client.searchMemory();
    expect(records[0]?.input).toEqual({ projectRoot: process.cwd() });
  });

  it("rejects relative projects and invalid backend overrides before sending data", async () => {
    const client = new OpenMembraneClient({ endpoint, daemonPaths, env: {} });
    await expect(client.ingest({ projectRoot: "relative", summary: "Test" })).rejects.toThrow("absolute");
    const badEnv = new OpenMembraneClient({ endpoint, daemonPaths, env: { OPENMEMBRANE_STORAGE_BACKEND: "invalid" } });
    await expect(badEnv.searchMemory()).rejects.toThrow();
    expect(records).toHaveLength(0);
  });

  it.each(["VALIDATION_ERROR", E_DAEMON_NOT_RUNNING])("preserves remote %s errors and diagnostic IDs without launching", async (code) => {
    respond = (_req, res) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { code, safeMessage: "Invalid request.", diagnosticId: "diag_123" } }));
    };
    const autoLaunch = vi.fn();
    const client = new OpenMembraneClient({ endpoint, daemonPaths, env: {}, autoLaunch });
    await expect(client.searchMemory()).rejects.toMatchObject({
      code, message: "Invalid request.", safeMessage: "Invalid request.", diagnosticId: "diag_123", origin: "daemon",
    });
    expect(autoLaunch).not.toHaveBeenCalled();
  });

  it.each([
    [200, "not-json"],
    [200, JSON.stringify({ invalid: "shape" })],
    [503, JSON.stringify({ unavailable: true })],
  ])("rejects invalid HTTP/JSON/protocol responses (%s)", async (status, body) => {
    respond = (_req, res) => { res.statusCode = status; res.end(body); };
    const client = new OpenMembraneClient({ endpoint, daemonPaths });
    await expect(client.searchMemory()).rejects.toMatchObject({ code: "E_INVALID_RESPONSE" });
  });

  it("reports a missing daemon with the stable code", async () => {
    await close();
    const client = new OpenMembraneClient({ endpoint, daemonPaths });
    await expect(client.searchMemory()).rejects.toMatchObject({ code: E_DAEMON_NOT_RUNNING });
  });

  it("keeps health unauthenticated when no token exists", async () => {
    await rm(resolveDaemonPaths(daemonPaths).tokenPath);
    const client = new OpenMembraneClient({ endpoint, daemonPaths });
    expect(await client.health()).toEqual({});
    const autoLaunch = vi.fn();
    const authenticated = new OpenMembraneClient({ endpoint, daemonPaths, autoLaunch });
    await expect(authenticated.searchMemory()).rejects.toMatchObject({ code: "E_TOKEN_UNAVAILABLE" });
    expect(autoLaunch).not.toHaveBeenCalled();
  });

  it("rejects empty or header-injecting tokens without sending requests", async () => {
    const path = resolveDaemonPaths(daemonPaths).tokenPath;
    for (const value of ["", "token\r\nx-header: injected"]) {
      await writeFile(path, value);
      await expect(loadDaemonToken(daemonPaths)).rejects.toMatchObject({ code: "E_TOKEN_INVALID" });
    }
    expect(records).toHaveLength(0);
  });

  it("reloads token files after token rotation", async () => {
    respond = (_req, res) => res.end("[]");
    const client = new OpenMembraneClient({ endpoint, daemonPaths });
    await client.searchMemory();
    await writeFile(resolveDaemonPaths(daemonPaths).tokenPath, "rotated-token");
    await client.searchMemory();
    expect(records.map((record) => record.authorization)).toEqual(["Bearer test-token", "Bearer rotated-token"]);
  });

  it("times out a stalled request without launching or retrying writes", async () => {
    respond = () => {};
    const autoLaunch = vi.fn();
    const client = new OpenMembraneClient({ endpoint, daemonPaths, requestTimeoutMs: 30, autoLaunch });
    await expect(client.remember({ content: "Use standalone components.", type: "coding_rule" })).rejects.toMatchObject({ code: "E_REQUEST_TIMEOUT" });
    expect(records).toHaveLength(1);
    expect(autoLaunch).not.toHaveBeenCalled();
  });

  it("does not replay mutations after a connection reset", async () => {
    respond = (req) => req.socket.destroy();
    const autoLaunch = vi.fn();
    const client = new OpenMembraneClient({ endpoint, daemonPaths, autoLaunch });
    await expect(client.remember({ content: "Use standalone components.", type: "coding_rule" })).rejects.toMatchObject({ code: "E_TRANSPORT_ERROR" });
    expect(records).toHaveLength(1);
    expect(autoLaunch).not.toHaveBeenCalled();
  });

  it("reports a truncated response without replaying the request", async () => {
    respond = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-length": 200 });
      res.write('{"savedCount":');
      setTimeout(() => res.destroy(), 5);
    };
    const autoLaunch = vi.fn();
    const client = new OpenMembraneClient({ endpoint, daemonPaths, requestTimeoutMs: 100, autoLaunch });
    await expect(client.remember({ content: "Use standalone components.", type: "coding_rule" })).rejects.toMatchObject({ code: "E_TRANSPORT_ERROR" });
    expect(records).toHaveLength(1);
    expect(autoLaunch).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "win32")("coalesces startup, polls health, reloads the Windows endpoint, then retries", async () => {
    await close();
    const paths = { ...daemonPaths, platform: "win32" as const };
    const endpointFile = resolveDaemonPaths(paths).endpointPath;
    await writeFile(endpointFile, JSON.stringify(endpoint));
    let healthCalls = 0;
    respond = (req, res) => {
      if (req.url === "/v1/health") { healthCalls++; res.end("{}"); }
      else res.end("[]");
    };
    const autoLaunch = vi.fn(async () => {
      await listen();
      await writeFile(endpointFile, JSON.stringify(endpoint));
    });
    const client = new OpenMembraneClient({ daemonPaths: paths, autoLaunch, pollIntervalMs: 5 });
    const results = await Promise.all([client.searchMemory(), client.listMemoryCandidates()]);
    expect(results).toEqual([[], []]);
    expect(autoLaunch).toHaveBeenCalledTimes(1);
    expect(healthCalls).toBeGreaterThan(0);
    expect(records.filter((record) => record.path !== "/v1/health")).toHaveLength(2);
  });

  it("auto-launches after first-use missing token and waits for health", async () => {
    await close();
    await rm(resolveDaemonPaths(daemonPaths).tokenPath);
    const previousEndpoint = endpoint;
    respond = (req, res) => res.end(req.url === "/v1/health" ? "{}" : "[]");
    const autoLaunch = vi.fn(async () => {
      await writeFile(resolveDaemonPaths(daemonPaths).tokenPath, "new-token");
      await new Promise<void>((resolveListen) => {
        if (previousEndpoint.transport !== "tcp") throw new Error("Expected TCP.");
        server.listen(previousEndpoint.port, previousEndpoint.host, resolveListen);
      });
    });
    const client = new OpenMembraneClient({ endpoint, daemonPaths, autoLaunch, pollIntervalMs: 5 });
    expect(await client.searchMemory()).toEqual([]);
    expect(autoLaunch).toHaveBeenCalledTimes(1);
    expect(records.at(-1)?.authorization).toBe("Bearer new-token");
  });

  it("bounds startup readiness polling and surfaces launch failures", async () => {
    await close();
    const autoLaunch = vi.fn();
    const client = new OpenMembraneClient({ endpoint, daemonPaths, autoLaunch, timeoutMs: 30, pollIntervalMs: 5 });
    await expect(client.health()).rejects.toMatchObject({ code: E_DAEMON_NOT_RUNNING });
    expect(autoLaunch).toHaveBeenCalledTimes(1);
    const launchFailure = new Error("Launch failed");
    const failed = new OpenMembraneClient({ endpoint, daemonPaths, autoLaunch: () => { throw launchFailure; } });
    await expect(failed.health()).rejects.toBe(launchFailure);
  });

  it("rejects non-loopback endpoint overrides and invalid timeouts", () => {
    expect(() => new OpenMembraneClient({ endpoint: { transport: "tcp", host: "0.0.0.0" as "127.0.0.1", port: 1234 } })).toThrow();
    expect(() => new OpenMembraneClient({ requestTimeoutMs: 0 })).toThrow("positive");
  });

  it.skipIf(process.platform !== "win32")("loads only loopback TCP endpoints from the Windows run directory", async () => {
    const paths = { ...daemonPaths, platform: "win32" as const };
    const file = resolveDaemonPaths(paths).endpointPath;
    await writeFile(file, JSON.stringify(endpoint));
    expect(await resolveDaemonEndpoint(paths)).toEqual(endpoint);
    await writeFile(file, JSON.stringify({ transport: "tcp", host: "192.0.2.1", port: 1234 }));
    await expect(resolveDaemonEndpoint(paths)).rejects.toThrow();
    await writeFile(file, JSON.stringify({ transport: "socket", socketPath: "/tmp/socket" }));
    await expect(resolveDaemonEndpoint(paths)).rejects.toThrow("loopback");
  });

  it.skipIf(process.platform === "win32")("uses the shared Unix socket resolver for real requests", async () => {
    await close();
    const socket = await resolveDaemonEndpoint(daemonPaths);
    if (socket.transport !== "socket") throw new Error("Expected Unix socket.");
    await new Promise<void>((resolveListen) => server.listen(socket.socketPath, resolveListen));
    respond = (req, res) => res.end(req.url === "/v1/health" ? "{}" : "[]");
    const client = new OpenMembraneClient({ daemonPaths });
    expect(await client.health()).toEqual({});
    expect(await client.searchMemory()).toEqual([]);
    expect(records.at(-1)?.authorization).toBe("Bearer test-token");
  });
});
