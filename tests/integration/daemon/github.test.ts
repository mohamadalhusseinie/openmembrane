import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenMembraneClient } from "@openmembrane/client";
import { createOpenMembraneService } from "@openmembrane/service";
import type { CommandRunner } from "@openmembrane/service";
import type { Command, CommandResult } from "../../../packages/service/src/collaboration/GitHubCli";
import { startDaemon } from "../../../apps/daemon/src/server";
import type { RunningDaemon } from "../../../apps/daemon/src/server";

const directories: string[] = [];
const daemons: RunningDaemon[] = [];
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close()));
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

class TeamRunner implements CommandRunner {
  readonly commands: Command[] = [];
  failure: "missing" | "auth" | "publication" | undefined;
  onPublish: (() => Promise<void>) | undefined;

  async run(command: Command): Promise<CommandResult> {
    this.commands.push(command);
    const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
    if (command.executable === "gh") {
      if (this.failure === "missing") return { exitCode: -1, stdout: "", stderr: "sensitive gh output", errorCode: "ENOENT" };
      if (command.args[0] === "--version") return ok("gh version test");
      if (command.args[0] === "auth") return this.failure === "auth" ? { exitCode: 1, stdout: "", stderr: "sensitive gh output" } : ok();
      if (command.args[0] === "repo") return ok(JSON.stringify({
        nameWithOwner: "team/memory", isPrivate: true, defaultBranch: null, url: "https://github.example.test/team/memory",
      }));
      if (command.args[1] === "list") return ok("[]");
      if (command.args[1] === "create") {
        await this.onPublish?.();
        return this.failure === "publication"
          ? { exitCode: 1, stdout: "", stderr: "sensitive gh output" }
          : ok("https://github.example.test/team/memory/pull/42\n");
      }
    }
    if (command.executable === "git") {
      if (command.args[0] === "clone") await mkdir(command.args[command.args.length - 1]!, { recursive: true });
      if (command.args[2] === "show") {
        if (command.args[3]?.endsWith(":.openmembrane/project.json")) {
          try {
            return ok(await readFile(join(command.args[1]!, ".openmembrane", "project.json"), "utf8"));
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
          }
        }
        return { exitCode: 1, stdout: "", stderr: "file not found" };
      }
      if (command.args[2] === "rev-parse") return ok("a".repeat(40));
      if (command.args[2] === "remote") return ok("https://github.example.test/team/memory.git");
      return ok();
    }
    throw new Error(`Unexpected test command: ${command.executable}`);
  }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "omg-"));
  directories.push(root);
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  const paths = { homeDir: root, runtimeDir: root };
  const runner = new TeamRunner();
  const daemon = await startDaemon({ paths, serviceOptions: { githubRunner: runner } });
  daemons.push(daemon);
  const client = new OpenMembraneClient({ endpoint: daemon.endpoint, daemonPaths: paths, projectRoot, env: {} });
  const repository = { host: "github.example.test", owner: "team", name: "memory" };
  return { projectRoot, client, runner, repository, daemon };
}

describe("GitHub Team through the daemon", () => {
  it("configures, reports status, and publishes with gh in the caller's project directory", async () => {
    const { client, runner, projectRoot, repository } = await setup();
    expect(await client.configureGitHubTeamMode({ repository })).toMatchObject({ kind: "configured" });
    expect(await client.getCollaborationStatus()).toMatchObject({ mode: "github_team", repository });
    const result = await client.remember({
      content: "Team changes must pass isolated integration tests before merge.", type: "testing_rule", confidence: "high",
    });
    expect(result.proposalCount).toBe(1);
    expect(result.proposals).toMatchObject([{ state: "proposed" }]);
    const gh = runner.commands.filter((command) => command.executable === "gh");
    expect(gh.some((command) => command.args[1] === "create")).toBe(true);
    expect(gh.every((command) => command.cwd === projectRoot)).toBe(true);
    expect(await client.getCollaborationStatus()).toMatchObject({ proposals: { proposed: 1 } });
  });

  it.each([
    ["missing", "GITHUB_CLI_UNAVAILABLE"],
    ["auth", "GITHUB_AUTH_REQUIRED"],
  ] as const)("returns a diagnostic error for %s gh and remains available", async (failure, code) => {
    const { client, runner, repository } = await setup();
    runner.failure = failure;
    await expect(client.configureGitHubTeamMode({ repository })).rejects.toMatchObject({
      code, diagnosticId: expect.any(String), origin: "daemon",
    });
    expect(await client.health()).toEqual({});
    expect(await client.getDiagnostics()).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
    runner.failure = undefined;
    expect(await client.configureGitHubTeamMode({ repository })).toMatchObject({ kind: "configured" });
    runner.failure = failure;
    await expect(client.getCollaborationStatus()).rejects.toMatchObject({ code, diagnosticId: expect.any(String) });
    await expect(client.remember({
      content: "Team changes must pass isolated integration tests before deployment.", type: "testing_rule", confidence: "high",
    })).rejects.toMatchObject({ code, diagnosticId: expect.any(String) });
    expect(await client.health()).toEqual({});
    runner.failure = undefined;
    expect(await client.getCollaborationStatus()).toMatchObject({ proposals: { proposed: 0 } });
  });

  it("persists failed publication backoff and retries only on eligible retrieval", async () => {
    const { client, runner, repository, projectRoot } = await setup();
    await client.configureGitHubTeamMode({ repository });
    runner.failure = "publication";
    const result = await client.remember({
      content: "Team changes must pass isolated integration tests before deployment.", type: "testing_rule", confidence: "high",
    });
    expect(result.proposals).toMatchObject([{ state: "retry_scheduled", nextAttemptAt: expect.any(String) }]);
    const publications = () => runner.commands.filter((command) => command.executable === "gh" && command.args[1] === "create").length;
    expect(publications()).toBe(1);
    await client.searchMemory({ query: "publication" });
    expect(publications()).toBe(1);
    const status = await client.getCollaborationStatus();
    expect(status.retries).toHaveLength(1);
    const service = createOpenMembraneService({ githubRunner: runner });
    try {
      const state = await service.projectState({ projectRoot, storageBackend: "json" });
      const proposal = (await state.collaborationStore.listProposals("project"))[0]!;
      await state.collaborationStore.saveProposal({
        ...proposal, retry: { ...proposal.retry, nextAttemptAt: "2020-01-01T00:00:00.000Z" },
      });
    } finally {
      await service.close();
    }
    runner.failure = undefined;
    await client.getProjectRules();
    const retriedStatus = await client.getCollaborationStatus();
    expect(publications()).toBe(2);
    expect(retriedStatus).toMatchObject({ retries: [], proposals: { proposed: 1 } });
  });

  it("drains an in-flight publication before closing project stores", async () => {
    const { client, runner, repository, daemon } = await setup();
    await client.configureGitHubTeamMode({ repository });
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    runner.onPublish = async () => { entered(); await gate; };
    const request = client.remember({
      content: "Team changes must pass the complete build before merging.", type: "testing_rule", confidence: "high",
    });
    await Promise.race([started, request.then(() => { throw new Error("Request did not reach publication."); })]);
    let closed = false;
    const shutdown = daemon.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    expect((await request).proposalCount).toBe(1);
    await shutdown;
    expect(closed).toBe(true);
  });
});
