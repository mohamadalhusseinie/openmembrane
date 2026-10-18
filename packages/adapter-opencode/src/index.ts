import { createRequire } from "node:module";
import { createDaemonAutoLaunch, OpenMembraneClient } from "@openmembrane/client";
import type { Plugin } from "@opencode-ai/plugin";
import { createHooks, detectProject } from "./plugin";

const OpenMembrane: Plugin = async (input) => {
  const project = await detectProject(input.directory, process.env);
  const options = {
    ...project,
    autoLaunch: () => createDaemonAutoLaunch(
      process.execPath,
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
};

export default OpenMembrane;
