import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { z } from "zod";

export interface DaemonPathOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  runtimeDir?: string;
}

export interface DaemonPaths {
  runDir: string;
  socketPath: string;
  endpointPath: string;
  tokenPath: string;
}

export const daemonEndpointSchema = z.discriminatedUnion("transport", [
  z.object({ transport: z.literal("socket"), socketPath: z.string().min(1) }).strict(),
  z.object({ transport: z.literal("tcp"), host: z.literal("127.0.0.1"), port: z.number().int().min(1).max(65535) }).strict(),
]);
export type DaemonEndpoint = z.infer<typeof daemonEndpointSchema>;

export function resolveDaemonPaths(options: DaemonPathOptions = {}): DaemonPaths {
  const platform = options.platform ?? process.platform;
  const path = platform === "win32" ? win32 : posix;
  const home = options.homeDir ?? homedir();
  const runtime = options.runtimeDir ?? process.env.XDG_RUNTIME_DIR;
  if (!path.isAbsolute(home) || (platform !== "win32" && runtime !== undefined && runtime !== "" && !path.isAbsolute(runtime))) {
    throw new Error("Daemon home and runtime directories must be absolute paths.");
  }
  const runDir = platform !== "win32" && runtime
    ? path.join(runtime, "openmembrane")
    : path.join(home, ".openmembrane", "run");
  return {
    runDir,
    socketPath: path.join(runDir, "daemon.sock"),
    endpointPath: path.join(runDir, "endpoint.json"),
    tokenPath: path.join(runDir, "token"),
  };
}

export async function resolveDaemonEndpoint(options: DaemonPathOptions = {}): Promise<DaemonEndpoint> {
  const paths = resolveDaemonPaths(options);
  if ((options.platform ?? process.platform) !== "win32") {
    return { transport: "socket", socketPath: paths.socketPath };
  }
  const endpoint = daemonEndpointSchema.parse(JSON.parse(await readFile(paths.endpointPath, "utf8")));
  if (endpoint.transport !== "tcp") throw new Error("Windows daemon endpoint must use loopback TCP.");
  return endpoint;
}
