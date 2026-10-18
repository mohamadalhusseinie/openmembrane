import { createRequire } from "node:module";
import { createDaemonAutoLaunch, OpenMembraneClient } from "@openmembrane/client";
import type { Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { createHooks, detectProject } from "./plugin";

const OpenMembrane = (async (
  input: Pick<PluginInput, "directory" | "client">,
  options: PluginOptions = {},
): Promise<Hooks> => {
  const project = await detectProject(input.directory, process.env);
  const clientOptions = {
    ...project,
    autoLaunch: () => createDaemonAutoLaunch(
      "node",
      [createRequire(import.meta.url).resolve("openmembrane"), "serve"],
      { cwd: project.projectRoot },
    )(),
  };
  const daemon = new OpenMembraneClient(clientOptions);
  const ingestion = new OpenMembraneClient({
    ...clientOptions,
    requestTimeoutMs: 30 * 60_000,
  });
  return createHooks(input, {
    getProjectRules: (request) => daemon.getProjectRules(request),
    getRelevantContext: (request) => daemon.getRelevantContext(request),
    ingest: (request) => ingestion.ingest(request),
  }, project, { allowMemoryEgress: options.allowMemoryEgress === true });
}) satisfies Plugin;

export default OpenMembrane;
