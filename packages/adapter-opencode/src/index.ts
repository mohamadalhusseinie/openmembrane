import { createRequire } from "node:module";
import { createDaemonAutoLaunch, OpenMembraneClient } from "@openmembrane/client";
import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import { createHooks, detectProject } from "./plugin";

const OpenMembrane = (async (input: Pick<PluginInput, "directory" | "client">): Promise<Hooks> => {
  const project = await detectProject(input.directory, process.env);
  const options = {
    ...project,
    autoLaunch: () => createDaemonAutoLaunch(
      "node",
      [createRequire(import.meta.url).resolve("openmembrane"), "serve"],
      { cwd: project.projectRoot },
    )(),
  };
  const daemon = new OpenMembraneClient(options);
  const ingestion = new OpenMembraneClient({
    ...options,
    requestTimeoutMs: 30 * 60_000,
  });
  return createHooks(input, {
    getProjectRules: (request) => daemon.getProjectRules(request),
    getRelevantContext: (request) => daemon.getRelevantContext(request),
    ingest: (request) => ingestion.ingest(request),
  }, project);
}) satisfies Plugin;

export default OpenMembrane;
