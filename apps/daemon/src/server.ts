import { randomBytes, timingSafeEqual } from "node:crypto";
import { unlink } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, RequestListener, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createOpenMembraneService } from "@openmembrane/service";
import type { CreateServiceOptions } from "@openmembrane/service";
import { resolveDaemonPaths } from "@openmembrane/protocol";
import type { DaemonEndpoint, DaemonPathOptions } from "@openmembrane/protocol";
import { createId } from "@openmembrane/shared";
import { acquireLock } from "./lock";
import { createLogger } from "./logging";
import { isMissing, privateDirectory, replacePrivateFile, writePrivateFile } from "./privateFiles";
import { createDaemonRouter, safeError } from "./routes";
import type { RouteResponse } from "../../review-ui/src/router";
import { DaemonLifecycleError } from "./errors";
import { z } from "zod";

export interface DaemonOptions {
  paths?: DaemonPathOptions;
  serviceOptions?: CreateServiceOptions;
  transport?: "socket" | "tcp";
  serverFactory?: (listener: RequestListener) => Server;
}

export interface RunningDaemon {
  endpoint: DaemonEndpoint;
  closed: Promise<void>;
  close(): Promise<void>;
}

const maxBodyBytes = 2 * 1024 * 1024;
const stopInputSchema = z.object({ instanceId: z.string().uuid() }).strict();

async function readBody(req: IncomingMessage): Promise<{ ok: true; value: Buffer } | { ok: false }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const cleanup = (): void => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const onData = (chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        req.off("data", onData);
        chunks.length = 0;
        req.resume();
        resolve({ ok: false });
      } else {
        chunks.push(chunk);
      }
    };
    const onEnd = (): void => {
      cleanup();
      resolve({ ok: true, value: Buffer.concat(chunks) });
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

function send(res: ServerResponse, response: RouteResponse): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(response.status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "connection": "close",
    ...response.headers,
  });
  res.end(JSON.stringify(response.body ?? {}));
}

export async function startDaemon(options: DaemonOptions = {}): Promise<RunningDaemon> {
  const paths = resolveDaemonPaths(options.paths);
  const transport = options.transport ?? ((options.paths?.platform ?? process.platform) === "win32" ? "tcp" : "socket");
  if (process.platform === "win32" && transport !== "tcp") throw new Error("Windows daemon requires loopback TCP.");
  await privateDirectory(paths.runDir);
  const logger = await createLogger(options.paths?.homeDir);
  const lock = await acquireLock(paths.runDir);
  const service = createOpenMembraneService({ deferExtractionInitialization: true, ...options.serviceOptions });
  const token = randomBytes(32).toString("hex");
  const router = createDaemonRouter(service, logger);
  const inFlight = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  let listenerFailure: DaemonLifecycleError | undefined;
  let resolveClosed: () => void = () => undefined;
  let rejectClosed: (error: unknown) => void = () => undefined;
  const closed = new Promise<void>((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject; });
  // Embedders can await closed later without an unhandled rejection during startup.
  void closed.catch(() => undefined);

  function authenticated(req: IncomingMessage): boolean {
    const authorization = req.headers.authorization;
    if (authorization === undefined) return false;
    const expected = Buffer.from(`Bearer ${token}`);
    const supplied = Buffer.from(authorization);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (closing && !(req.method === "GET" && url.pathname === "/v1/daemon/identity")) {
      send(res, await safeError(logger, 503, "DAEMON_STOPPING", "The daemon is stopping."));
      return;
    }
    if (!(req.method === "GET" && url.pathname === "/v1/health") && !authenticated(req)) {
      req.resume();
      send(res, await safeError(logger, 401, "UNAUTHORIZED", "A valid daemon token is required."));
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/daemon/stop") {
      const content = await readBody(req);
      if (!content.ok) {
        send(res, await safeError(logger, 413, "VALIDATION_ERROR", "The request body exceeds the size limit."));
        return;
      }
      let input: unknown;
      try { input = JSON.parse(content.value.toString("utf8")); } catch { input = undefined; }
      const parsed = stopInputSchema.safeParse(input);
      if (!parsed.success) {
        send(res, await safeError(logger, 400, "VALIDATION_ERROR", "Provide the expected daemon instanceId to stop."));
        return;
      }
      if (parsed.data.instanceId !== lock.record.instanceId) {
        send(res, await safeError(logger, 409, "DAEMON_INSTANCE_MISMATCH", "The daemon instance changed; shutdown was not requested."));
        return;
      }
      send(res, { status: 200, body: {} });
      setImmediate(() => { void close(); });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/daemon/identity") {
      req.resume();
      send(res, { status: 200, body: { instanceId: lock.record.instanceId } });
      return;
    }
    const match = router.match(req.method ?? "", url.pathname);
    if (!match) {
      req.resume();
      send(res, await safeError(logger, 404, "NOT_FOUND", "The daemon endpoint was not found."));
      return;
    }
    let body: unknown;
    if (req.method !== "GET") {
      const content = await readBody(req);
      if (!content.ok) {
        send(res, await safeError(logger, 413, "VALIDATION_ERROR", "The request body exceeds the size limit."));
        return;
      }
      try {
        body = JSON.parse(content.value.toString("utf8"));
      } catch {
        send(res, await safeError(logger, 400, "VALIDATION_ERROR", "Provide a JSON request body."));
        return;
      }
    }
    const response = await match.handler({ params: match.params, query: url.searchParams, body, req, res });
    send(res, response);
    await response.afterResponse?.();
  }

  const serverFactory = options.serverFactory ?? ((listener: RequestListener) =>
    createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, listener));
  const server = serverFactory((req, res) => {
    const work = handle(req, res).catch(async () => {
      try {
        send(res, await safeError(logger, 500, "UNKNOWN_ERROR", "The daemon could not handle the request."));
      } catch {
        process.stderr.write("OpenMembrane daemon could not write diagnostics.\n");
        send(res, { status: 500, body: { error: {
          code: "DAEMON_LOG_ERROR", safeMessage: "The daemon could not write local diagnostics.", diagnosticId: createId("diag"),
        } } });
      }
    }).finally(() => { inFlight.delete(work); });
    inFlight.add(work);
  });

  async function remove(path: string): Promise<void> {
    await unlink(path).catch((error: unknown) => { if (!isMissing(error)) throw error; });
  }

  async function cleanup(): Promise<void> {
    const failures: unknown[] = [];
    const ownsDiscovery = await lock.protectCleanup();
    for (const operation of [
      () => service.close(),
      ...(ownsDiscovery ? [
        () => remove(paths.endpointPath),
        () => remove(paths.tokenPath),
        ...(transport === "socket" ? [() => remove(paths.socketPath)] : []),
      ] : []),
      () => lock.release(),
    ]) {
      try { await operation(); } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Daemon cleanup failed.");
  }

  function close(): Promise<void> {
    if (!closing) {
      closing = (async () => {
        try {
          await lock.protectCleanup();
          if (server.listening) {
            await new Promise<void>((resolve, reject) => {
              server.close((error) => error ? reject(error) : resolve());
              if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
            });
          }
          await Promise.all(inFlight);
        } finally {
          await cleanup();
        }
        if (listenerFailure) {
          await logger.write("listener_failed", createId("diag"), listenerFailure.code);
          throw listenerFailure;
        }
        await logger.write("stopped");
      })();
      void closing.then(resolveClosed, rejectClosed);
    }
    return closing;
  }

  try {
    await remove(paths.endpointPath);
    await remove(paths.tokenPath);
    if (transport === "socket") await remove(paths.socketPath);
    await writePrivateFile(paths.tokenPath, token);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      const ready = (): void => { server.off("error", reject); resolve(); };
      if (transport === "socket") server.listen(paths.socketPath, ready);
      else server.listen(0, "127.0.0.1", ready);
    });
    const endpoint: DaemonEndpoint = transport === "socket"
      ? { transport: "socket", socketPath: paths.socketPath }
      : { transport: "tcp", host: "127.0.0.1", port: (server.address() as AddressInfo).port };
    if (transport === "socket") {
      const { chmod } = await import("node:fs/promises");
      await chmod(paths.socketPath, 0o600);
    }
    const endpointDraft = `${paths.endpointPath}.${lock.record.instanceId}`;
    await writePrivateFile(endpointDraft, JSON.stringify(endpoint));
    try {
      await replacePrivateFile(endpointDraft, paths.endpointPath);
    } finally {
      await remove(endpointDraft);
    }
    await lock.publish(endpoint);
    await logger.write("started");
    server.on("error", (error: Error) => {
      listenerFailure ??= new DaemonLifecycleError("DAEMON_LISTENER_ERROR", "The daemon listener failed. See the local daemon log.");
      listenerFailure.cause = error;
      void close();
    });
    return { endpoint, closed, close };
  } catch (error) {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanup();
    throw error;
  }
}
