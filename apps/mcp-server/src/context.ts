import { OpenMembraneClient, createDaemonAutoLaunch } from "@openmembrane/client";
import type { OpenMembraneClientOptions } from "@openmembrane/client";
import { daemonEnvironment } from "../../daemon/src/environment";

export interface OpenMembraneMcpContext {
  client: Pick<OpenMembraneClient,
    "remember" | "getProjectRules" | "getRelevantContext" | "searchMemory" |
    "listMemoryCandidates" | "approveMemoryCandidate" | "rejectMemoryCandidate">;
}

export function createOpenMembraneContext(options: OpenMembraneClientOptions = {}): OpenMembraneMcpContext {
  return {
    client: new OpenMembraneClient({
      requestTimeoutMs: 30 * 60_000,
      ...options,
      autoLaunch: options.autoLaunch ?? createDaemonAutoLaunch(
        process.execPath,
        [...process.execArgv, process.argv[1]!, "serve"],
        { env: daemonEnvironment(options.env ?? process.env) },
      ),
    }),
  };
}
