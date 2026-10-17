import { randomBytes, timingSafeEqual } from "node:crypto";
import { unlink } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, RequestListener, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createOpenMembraneService, ExecFileCommandRunner } from "@openmembrane/service";
import type { CreateServiceOptions, OpenMembraneService } from "@openmembrane/service";
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
import { daemonEnvironment } from "./environment";

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
  let service: OpenMembraneService | undefined;
  let server: Server | undefined;
  let token: string;
  let router: ReturnType<typeof createDaemonRouter>;
  const inFlight = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  let listenerFailure: DaemonLifecycleError | undefined;
  let startupComplete = false;
  let rejectListen: ((error: Error) => void) | undefined;
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
    if ((!startupComplete || closing) && !(req.method === "GET" && url.pathname === "/v1/daemon/identity")) {
      send(res, await safeError(logger, 503,
        closing ? "DAEMON_STOPPING" : "DAEMON_STARTING",
        closing ? "The daemon is stopping." : "The daemon is starting."));
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

  const requestListener: RequestListener = (req, res) => {
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
  };

  function checkListener(): void {
    if (listenerFailure) throw listenerFailure;
  }

  async function remove(path: string): Promise<void> {
    await unlink(path).catch((error: unknown) => { if (!isMissing(error)) throw error; });
  }

  async function cleanup(ownsDiscovery: boolean, failures: unknown[]): Promise<void> {
    for (const operation of [
      () => service?.close(),
      ...(ownsDiscovery ? [
        () => remove(paths.endpointPath),
        () => remove(paths.tokenPath),
        ...(transport === "socket" ? [() => remove(paths.socketPath)] : []),
      ] : []),
      () => lock.release(),
    ]) {
      try { await operation(); } catch (error) { failures.push(error); }
    }
  }

  function close(): Promise<void> {
    if (!closing) {
      closing = (async () => {
        const failures: unknown[] = [];
        let ownsDiscovery = false;
        try {
          ownsDiscovery = await lock.protectCleanup();
        } catch (error) {
          failures.push(error);
        }
        try {
          const listener = server;
          if (listener?.listening) {
            await new Promise<void>((resolve, reject) => {
              listener.close((error) => error ? reject(error) : resolve());
              if (typeof listener.closeIdleConnections === "function") listener.closeIdleConnections();
            });
          }
        } catch (error) {
          failures.push(error);
        }
        const drained = await Promise.allSettled(inFlight);
        for (const result of drained) {
          if (result.status === "rejected") failures.push(result.reason);
        }
        await cleanup(ownsDiscovery, failures);
        if (listenerFailure) {
          await logger.write("listener_failed", createId("diag"), listenerFailure.code);
          if (failures.length > 0) failures.unshift(listenerFailure);
          else throw listenerFailure;
        }
        if (failures.length > 0) {
          const failure = new DaemonLifecycleError("DAEMON_CLEANUP_ERROR", "The daemon could not complete all shutdown cleanup. See the local daemon log.");
          failure.cause = new AggregateError(failures, "Daemon cleanup failed.");
          await logger.write("shutdown_failed", createId("diag"), failure.code);
          throw failure;
        }
        await logger.write("stopped");
      })();
      void closing.then(resolveClosed, rejectClosed);
    }
    return closing;
  }

  try {
    service = createOpenMembraneService({
      deferExtractionInitialization: true,
      ...options.serviceOptions,
      githubRunner: options.serviceOptions?.githubRunner ?? new ExecFileCommandRunner(() => daemonEnvironment()),
    });
    token = randomBytes(32).toString("hex");
    router = createDaemonRouter(service, logger);
    const serverFactory = options.serverFactory ?? ((listener: RequestListener) =>
      createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, listener));
    const listener = serverFactory(requestListener);
    server = listener;
    listener.on("error", (error: Error) => {
      listenerFailure ??= new DaemonLifecycleError("DAEMON_LISTENER_ERROR", "The daemon listener failed. See the local daemon log.");
      listenerFailure.cause = error;
      rejectListen?.(listenerFailure);
      if (startupComplete) void close();
    });
    await remove(paths.endpointPath);
    await remove(paths.tokenPath);
    if (transport === "socket") await remove(paths.socketPath);
    await writePrivateFile(paths.tokenPath, token);
    checkListener();
    await new Promise<void>((resolve, reject) => {
      rejectListen = reject;
      const ready = (): void => { rejectListen = undefined; resolve(); };
      if (transport === "socket") listener.listen(paths.socketPath, ready);
      else listener.listen(0, "127.0.0.1", ready);
    }).finally(() => { rejectListen = undefined; });
    checkListener();
    const endpoint: DaemonEndpoint = transport === "socket"
      ? { transport: "socket", socketPath: paths.socketPath }
      : { transport: "tcp", host: "127.0.0.1", port: (listener.address() as AddressInfo).port };
    if (transport === "socket") {
      const { chmod } = await import("node:fs/promises");
      await chmod(paths.socketPath, 0o600);
      checkListener();
    }
    const endpointDraft = `${paths.endpointPath}.${lock.record.instanceId}`;
    await writePrivateFile(endpointDraft, JSON.stringify(endpoint));
    try {
      checkListener();
      await replacePrivateFile(endpointDraft, paths.endpointPath);
    } finally {
      await remove(endpointDraft);
    }
    checkListener();
    await lock.publish(endpoint);
    checkListener();
    await logger.write("started");
    checkListener();
    startupComplete = true;
    return { endpoint, closed, close };
  } catch (error) {
    await close();
    throw error;
  }
}
