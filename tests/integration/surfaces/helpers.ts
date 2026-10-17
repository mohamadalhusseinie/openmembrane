import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenMembraneClient } from "@openmembrane/client";
import type { CommandRunner } from "@openmembrane/service";
import type { Command, CommandResult } from "../../../packages/service/src/collaboration/GitHubCli";
import { createStores } from "@openmembrane/storage";
import { startDaemon } from "../../../apps/daemon/src/server";
import { candidate, entry } from "../../unit/helpers";

export class PrivateTeamRunner implements CommandRunner {
  async run(command: Command): Promise<CommandResult> {
    const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
    if (command.executable === "gh") {
      if (command.args[0] === "--version" || command.args[0] === "auth") return ok();
      if (command.args[0] === "repo") return ok(JSON.stringify({
        nameWithOwner: "team/memory", isPrivate: true, defaultBranch: null,
        url: "https://github.example.test/team/memory",
      }));
    }
    if (command.executable === "git") {
      if (command.args[0] === "clone") await mkdir(command.args.at(-1)!, { recursive: true });
      if (command.args[2] === "remote") return ok("https://github.example.test/team/memory.git");
      if (command.args[2] === "rev-parse") return ok("a".repeat(40));
      if (command.args[2] === "show") {
        try {
          return ok(await readFile(join(command.args[1]!, ".openmembrane", "project.json"), "utf8"));
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
          return { exitCode: 1, stdout: "", stderr: "not found" };
        }
      }
      return ok();
    }
    throw new Error(`Unexpected test command: ${command.executable} ${command.args.join(" ")}`);
  }
}

export async function setupSurfaceDaemon(options: { runner?: CommandRunner; many?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "oms-"));
  const projectRoot = join(root, "project");
  const storageDir = join(root, "client-storage");
  await mkdir(projectRoot);
  const projectId = "surface-project";
  const stores = await createStores({ backend: "json", baseDir: storageDir });
  try {
    for (const item of [
      candidate({ projectId, id: "approve candidate" }),
      candidate({ projectId, id: "reject-candidate" }),
      candidate({ projectId, id: "bulk-candidate", content: "Database migrations must be reversible and independently tested." }),
      candidate({ projectId, id: "secret-candidate", sensitivity: "secret", recommendedAction: "reject" }),
    ]) await stores.pendingCandidateStore.save(item);
    await stores.memoryStore.save(entry({ projectId, id: "old memory", updatedAt: "2020-01-01T00:00:00.000Z" }));
    await stores.memoryStore.save(entry({ projectId, id: "confidential", sensitivity: "confidential", content: "Private deployment architecture must stay confidential." }));
    await stores.memoryStore.save(entry({ projectId, id: "superseded", status: "superseded" }));
    for (const event of [
      { id: "older-append", createdAt: "2026-02-01T00:00:00Z" },
      { id: "same-time-append", createdAt: "2026-02-01T00:00:00Z" },
      { id: "latest-append", createdAt: "2025-01-01T00:00:00Z" },
    ]) await stores.auditLogStore.append({ ...event, projectId, type: "memory_saved" });
    if (options.many) {
      for (let index = 0; index < 205; index++) {
        await stores.memoryStore.save(entry({ projectId, id: `memory-${index}`, content: `Memory fixture ${index} records a distinct project convention.` }));
        await stores.pendingCandidateStore.save(candidate({ projectId, id: `candidate-${index}` }));
      }
    }
  } finally {
    await stores.close?.();
  }
  const paths = { homeDir: root, runtimeDir: root };
  const daemon = await startDaemon({ paths, ...(options.runner ? { serviceOptions: { githubRunner: options.runner } } : {}) });
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: root, USERPROFILE: root, XDG_RUNTIME_DIR: root,
    OPENMEMBRANE_HOME: storageDir, OPENMEMBRANE_PROJECT_ID: projectId, OPENMEMBRANE_STORAGE_BACKEND: "json",
    OPENMEMBRANE_EXTRACTION_PROVIDER: "mock", OPENMEMBRANE_EXTRACTION_ENABLED: "false",
  };
  const clientOptions = { endpoint: daemon.endpoint, daemonPaths: paths, projectRoot, env };
  const client = new OpenMembraneClient(clientOptions);
  const cli = (args: string[], input?: string, overrides: NodeJS.ProcessEnv = {}) => new Promise<{ stdout: string; stderr: string }>((accept, reject) => {
    const child = execFile(process.execPath, [
      "--import", pathToFileURL(resolve("node_modules", "tsx", "dist", "loader.mjs")).href,
      resolve("apps", "mcp-server", "src", "index.ts"), ...args,
    ], { cwd: projectRoot, env: { ...env, ...overrides }, windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : accept({ stdout, stderr }));
    child.stdin?.end(input);
  });
  return {
    root, projectRoot, projectId, storageDir, paths, daemon, env, clientOptions, client, cli,
    async close() {
      await daemon.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
