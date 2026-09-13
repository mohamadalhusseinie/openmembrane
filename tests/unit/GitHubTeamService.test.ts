import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CollaborationProposal, CollaborationStore, DiagnosticEvent, DiagnosticsLogStore } from "@openmembrane/core";
import type { CollaborationProjectConfig, MemoryEntry } from "@openmembrane/core";
import { JsonCollaborationStore, JsonMemoryStore } from "@openmembrane/storage";
import { GitHubCli, type CommandRunner } from "../../apps/mcp-server/src/collaboration/GitHubCli";
import { GitHubTeamService } from "../../apps/mcp-server/src/collaboration/GitHubTeamService";
import { entry } from "./helpers";

const tempDirs: string[] = [];
const configuredAt = "2026-09-12T12:00:00.000Z";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Command {
  executable: string;
  args: readonly string[];
  cwd?: string;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  errorCode?: string;
}

class ExpectedCommandRunner {
  readonly commands: Command[] = [];
  private readonly responses = new Map<string, CommandResult[]>();

  respond(executable: string, args: readonly string[], result: CommandResult): void {
    this.responses.set(commandKey(executable, args), [result]);
  }

  respondSequence(executable: string, args: readonly string[], results: CommandResult[]): void {
    this.responses.set(commandKey(executable, args), [...results]);
  }

  async run(command: Command): Promise<CommandResult> {
    this.commands.push(command);
    const results = this.responses.get(commandKey(command.executable, command.args));
    const result = results?.shift();
    if (result === undefined) {
      if (command.executable === "gh" && command.args[0] === "pr" && command.args[1] === "view") {
        return pullRequestView({ state: "OPEN" });
      }
      if (command.executable === "git" && command.args[2] === "fetch" && command.args[4] === "refs/heads/main:refs/remotes/origin/main") {
        return success();
      }
      if (command.executable === "git" && command.args[2] === "show" &&
        (command.args[3]?.endsWith(":.openmembrane/manifest.json") || command.args[3]?.endsWith(":.openmembrane/project.json"))) {
        return { exitCode: 1, stdout: "", stderr: "path does not exist" };
      }
      throw new Error(`Unexpected command: ${command.executable} ${command.args.join(" ")}`);
    }
    return result;
  }
}

class InitialPublishThenUpdateRunner implements CommandRunner {
  readonly commands: Command[] = [];
  private initialBranchPushed = false;
  private proposalBranchFetched = false;

  constructor(private readonly checkoutPath: string) {}

  async run(command: Command): Promise<CommandResult> {
    this.commands.push(command);
    const proposalBranch = "openmembrane/memory/mem_1";

    if (command.executable === "git" && command.args[2] === "fetch" && command.args[4] === "refs/heads/main:refs/remotes/origin/main") return success();
    if (command.executable === "gh" && command.args[0] === "pr" && command.args[1] === "list") {
      return noOpenPullRequest();
    }
    if (command.executable === "gh" && command.args[0] === "pr" && command.args[1] === "view") return pullRequestView({ state: "OPEN" });
    if (command.executable === "git" && command.args[2] === "show") return { exitCode: 1, stdout: "", stderr: "not found" };
    if (command.executable === "git" && command.args.join("\u0000") === ["-C", this.checkoutPath, "checkout", "-B", proposalBranch, "origin/main"].join("\u0000")) {
      return success();
    }
    if (command.executable === "git" && command.args.join("\u0000") === ["-C", this.checkoutPath, "fetch", "origin", `refs/heads/${proposalBranch}:refs/remotes/origin/${proposalBranch}`].join("\u0000")) {
      this.proposalBranchFetched = true;
      return success();
    }
    if (command.executable === "git" && command.args.join("\u0000") === ["-C", this.checkoutPath, "checkout", "-B", proposalBranch, `origin/${proposalBranch}`].join("\u0000")) {
      return this.proposalBranchFetched ? success() : { exitCode: 1, stdout: "", stderr: "missing origin proposal branch" };
    }
    if (command.executable === "git" && command.args[2] === "add") return success();
    if (command.executable === "git" && command.args[2] === "commit") return success();
    if (command.executable === "git" && command.args[2] === "push") {
      this.initialBranchPushed = true;
      return success();
    }
    if (command.executable === "gh" && command.args[0] === "pr" && command.args[1] === "create") {
      return this.initialBranchPushed
        ? { exitCode: 0, stdout: "https://github.example.test/team/project-memory/pull/42\n", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "proposal branch was not pushed" };
    }
    if (command.executable === "gh" && command.args[0] === "pr" && command.args[1] === "edit") return success();
    throw new Error(`Unexpected command: ${command.executable} ${command.args.join(" ")}`);
  }
}

class PublicationRunner implements CommandRunner {
  readonly commands: Command[] = [];
  readonly committedManifests: Array<{ branch: string; manifest: string; memoryFiles: string[] }> = [];
  private currentBranch = "";
  private readonly defaultMemories: readonly CollaborationProposal["memory"][];
  private readonly metadataExists: boolean;

  constructor(
    private readonly checkoutPath: string,
    memories: readonly CollaborationProposal["memory"][] = [],
    metadataExists = true,
  ) {
    this.defaultMemories = memories;
    this.metadataExists = metadataExists;
  }

  async run(command: Command): Promise<CommandResult> {
    this.commands.push(command);
    if (command.executable === "git" && command.args[2] === "fetch" && command.args[4] === "refs/heads/main:refs/remotes/origin/main") return success();
    if (command.executable === "gh" && command.args[0] === "pr" && command.args[1] === "list") return noOpenPullRequest();
    if (command.executable === "gh" && command.args[0] === "pr" && command.args[1] === "create") {
      return { exitCode: 0, stdout: `https://github.example.test/team/project-memory/pull/${this.commands.filter((item) => item.executable === "gh" && item.args[1] === "create").length}\n`, stderr: "" };
    }
    if (command.executable === "git" && command.args[2] === "show") {
      const path = command.args[3]?.slice("origin/main:".length);
      if (path === ".openmembrane/project.json") {
        return this.metadataExists
          ? { exitCode: 0, stdout: `${JSON.stringify({ schemaVersion: 1, projectId: "project-a", defaultBranch: "main" })}\n`, stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "not found" };
      }
      if (path === ".openmembrane/manifest.json") {
        return {
          exitCode: 0,
          stdout: manifest(this.defaultMemories.map((memory) => {
            const file = remoteFile(memory);
            return { id: memory.id, contentHash: file.contentHash };
          })),
          stderr: "",
        };
      }
      const memory = this.defaultMemories.find((item) => `.openmembrane/memories/${item.id}.json` === path);
      return memory === undefined
        ? { exitCode: 1, stdout: "", stderr: "not found" }
        : { exitCode: 0, stdout: remoteFile(memory).content, stderr: "" };
    }
    if (command.executable === "git" && command.args[2] === "checkout") {
      this.currentBranch = command.args[4] ?? "";
      return success();
    }
    if (command.executable === "git" && command.args[2] === "commit") {
      try {
        this.committedManifests.push({
          branch: this.currentBranch,
          manifest: await readFile(join(this.checkoutPath, ".openmembrane", "manifest.json"), "utf8"),
          memoryFiles: await readdir(join(this.checkoutPath, ".openmembrane", "memories")),
        });
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    return success();
  }
}

class BootstrapPublicationRunner extends PublicationRunner {
  private bootstrapped = false;

  override async run(command: Command): Promise<CommandResult> {
    if (command.executable === "gh" && command.args[0] === "--version") return success();
    if (command.executable === "gh" && command.args[0] === "auth") return success();
    if (command.executable === "gh" && command.args[0] === "repo") return repositoryView({ isPrivate: true, defaultBranch: null });
    if (command.executable === "git" && command.args[2] === "ls-remote") {
      return { exitCode: 0, stdout: this.bootstrapped ? "abcdef0\trefs/heads/main\n" : "", stderr: "" };
    }
    if (command.executable === "git" && command.args[2] === "fetch" && !this.bootstrapped) {
      return { exitCode: 1, stdout: "", stderr: "default branch does not exist" };
    }
    if (command.executable === "git" && command.args[2] === "show" && !this.bootstrapped) return { exitCode: 1, stdout: "", stderr: "not found" };
    if (command.executable === "git" && command.args[2] === "push" && command.args[4] === "HEAD:refs/heads/main") this.bootstrapped = true;
    return super.run(command);
  }
}

class QueuedPublicationRunner extends PublicationRunner {
  private releaseFirstCheckout: (() => void) | undefined;
  private firstCheckoutStarted: (() => void) | undefined;
  readonly firstCheckout = new Promise<void>((resolve) => { this.firstCheckoutStarted = resolve; });
  readonly release = new Promise<void>((resolve) => { this.releaseFirstCheckout = resolve; });
  private checkoutCount = 0;

  override async run(command: Command): Promise<CommandResult> {
    if (command.executable === "git" && command.args[2] === "checkout") {
      this.checkoutCount += 1;
      if (this.checkoutCount === 1) {
        this.firstCheckoutStarted?.();
        await this.release;
      }
    }
    return super.run(command);
  }

  releaseCheckout(): void {
    this.releaseFirstCheckout?.();
  }
}

class InMemoryDiagnosticsLogStore implements DiagnosticsLogStore {
  readonly events: DiagnosticEvent[] = [];

  async append(event: DiagnosticEvent): Promise<void> {
    this.events.push(event);
  }

  async list(projectId: string): Promise<DiagnosticEvent[]> {
    return this.events.filter((event) => event.projectId === projectId);
  }
}

class FailOnceProposalStore implements CollaborationStore {
  private failuresRemaining: number;

  constructor(private readonly store: CollaborationStore, failures = 1) {
    this.failuresRemaining = failures;
  }

  getProjectConfig(projectId: string) { return this.store.getProjectConfig(projectId); }
  saveProjectConfig(config: CollaborationProjectConfig) { return this.store.saveProjectConfig(config); }
  getProposal(projectId: string, memoryId: string) { return this.store.getProposal(projectId, memoryId); }
  listProposals(projectId: string) { return this.store.listProposals(projectId); }
  async saveProposal(proposal: CollaborationProposal): Promise<CollaborationProposal> {
    if (this.failuresRemaining > 0 && proposal.state === "proposed" && proposal.review !== undefined) {
      this.failuresRemaining -= 1;
      throw new Error("simulated local persistence failure");
    }
    return this.store.saveProposal(proposal);
  }
  listEvents(projectId: string) { return this.store.listEvents(projectId); }
  appendEvent(event: import("@openmembrane/core").CollaborationEvent) { return this.store.appendEvent(event); }
  getCheckpoint(projectId: string) { return this.store.getCheckpoint(projectId); }
  saveCheckpoint(checkpoint: import("@openmembrane/core").CollaborationCheckpoint) {
    return this.store.saveCheckpoint(checkpoint);
  }
}

function commandKey(executable: string, args: readonly string[]): string {
  return `${executable}\u0000${args.join("\u0000")}`;
}

function success(): CommandResult {
  return { exitCode: 0, stdout: "", stderr: "" };
}

function repositoryView(input: { isPrivate: boolean; defaultBranch?: string | null }): CommandResult {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      nameWithOwner: "team/project-memory",
      isPrivate: input.isPrivate,
      defaultBranch: input.defaultBranch === null ? null : { name: input.defaultBranch ?? "main" },
      url: "https://github.example.test/team/project-memory",
    }),
    stderr: "",
  };
}

async function createStorageDir(): Promise<string> {
  const storageDir = await mkdtemp(join(tmpdir(), "openmembrane-github-team-service-test-"));
  tempDirs.push(storageDir);
  return storageDir;
}

function createService(
  storageDir: string,
  runner: CommandRunner,
  diagnostics = new InMemoryDiagnosticsLogStore(),
  now: () => string = () => configuredAt,
) {
  const collaborationStore = new JsonCollaborationStore(storageDir);
  const memoryStore = new JsonMemoryStore(storageDir);
  return {
    diagnostics,
    collaborationStore,
    memoryStore,
    service: new GitHubTeamService({
      collaborationStore,
      memoryStore,
      diagnosticsLogStore: diagnostics,
      github: new GitHubCli(runner),
      storageDir,
      now,
    }),
  };
}

function configureInput() {
  return {
    projectId: "project-a",
    repository: {
      host: "github.example.test",
      owner: "team",
      name: "project-memory",
    },
  };
}

function addGitHubChecks(runner: ExpectedCommandRunner, view: CommandResult): void {
  runner.respond("gh", ["--version"], { exitCode: 0, stdout: "gh version 2.0.0", stderr: "" });
  runner.respond("gh", ["auth", "status", "--hostname", "github.example.test"], success());
  runner.respond(
    "gh",
    ["repo", "view", "github.example.test/team/project-memory", "--json", "nameWithOwner,isPrivate,defaultBranch,url"],
    view,
  );
}

function addCheckoutCommands(runner: ExpectedCommandRunner, storageDir: string, files: string, projectFile?: string): void {
  const checkoutPath = join(storageDir, "collaboration", "repos", "project-a");
  runner.respond(
    "git",
    ["clone", "--origin", "origin", "--no-recurse-submodules", "https://github.example.test/team/project-memory", checkoutPath],
    success(),
  );
  runner.respond(
    "git",
    ["-C", checkoutPath, "ls-remote", "--refs", "origin"],
    { exitCode: 0, stdout: files, stderr: "" },
  );
  runner.respond(
    "git",
    ["-C", checkoutPath, "show", "origin/main:.openmembrane/project.json"],
    projectFile === undefined ? { exitCode: 1, stdout: "", stderr: "path does not exist" } : { exitCode: 0, stdout: projectFile, stderr: "" },
  );
}

function githubProjectConfig(storageDir: string): CollaborationProjectConfig {
  return {
    projectId: "project-a",
    mode: "github_team",
    repository: {
      host: "github.example.test",
      owner: "team",
      name: "project-memory",
      defaultBranch: "main",
    },
    checkoutPath: join(storageDir, "collaboration", "repos", "project-a"),
    createdAt: configuredAt,
    updatedAt: configuredAt,
  };
}

function acceptedMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return entry({
    id: "mem_1",
    projectId: "project-a",
    type: "coding_rule",
    content: "Use standalone components.",
    scope: "frontend",
    confidence: "high",
    sensitivity: "internal",
    reason: "The frontend architecture uses standalone components.",
    tags: ["frontend"],
    status: "active",
    createdAt: configuredAt,
    updatedAt: configuredAt,
    approvedAt: configuredAt,
    ...overrides,
  });
}

function existingOpenProposal(): CollaborationProposal {
  return {
    projectId: "project-a",
    memory: {
      id: "mem_1",
      projectId: "project-a",
      type: "coding_rule",
      content: "Use an old frontend pattern.",
      scope: "frontend",
      confidence: "high",
      sensitivity: "internal",
      reason: "Original proposal.",
      tags: ["frontend"],
      status: "active",
      createdAt: configuredAt,
      updatedAt: configuredAt,
    },
    state: "proposed",
    review: {
      provider: "github",
      id: "42",
      url: "https://github.example.test/team/project-memory/pull/42",
      branch: "openmembrane/memory/mem_1",
    },
    retry: { status: "not_scheduled", attempts: 0 },
    createdAt: configuredAt,
    updatedAt: configuredAt,
  };
}

function proposalBody(change: "create" | "update"): string {
  return [
    "<!-- openmembrane:memory=mem_1 -->",
    "",
    "OpenMembrane memory proposal.",
    "",
    "- Memory ID: `mem_1`",
    "- Type: `coding_rule`",
    "- Scope: `frontend`",
    `- Change: \`${change}\``,
    "",
  ].join("\n");
}

function addPublicationCommands(
  runner: ExpectedCommandRunner,
  storageDir: string,
  input: { commitMessage: string; pr?: "create" | "update"; startPoint?: string },
): void {
  const checkoutPath = githubProjectConfig(storageDir).checkoutPath;
  const branch = "openmembrane/memory/mem_1";
  if (input.startPoint === `origin/${branch}`) {
    runner.respond("git", ["-C", checkoutPath, "fetch", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`], success());
  }
  runner.respond("git", ["-C", checkoutPath, "checkout", "-B", branch, input.startPoint ?? "origin/main"], success());
  runner.respond("git", ["-C", checkoutPath, "add", "--", ".openmembrane"], success());
  runner.respond("git", ["-C", checkoutPath, "commit", "-m", input.commitMessage], success());
  runner.respond("git", ["-C", checkoutPath, "push", "origin", `HEAD:refs/heads/${branch}`], success());
  if (input.pr === "create") {
    runner.respond(
      "gh",
      [
        "pr", "create", "--repo", "github.example.test/team/project-memory", "--base", "main", "--head", branch,
        "--title", "memory: propose mem_1", "--body", proposalBody("create"),
      ],
      { exitCode: 0, stdout: "https://github.example.test/team/project-memory/pull/42\n", stderr: "" },
    );
  }
  if (input.pr === "update") {
    runner.respond(
      "gh",
      [
        "pr", "edit", "42", "--repo", "github.example.test/team/project-memory", "--base", "main",
        "--title", "memory: update mem_1", "--body", proposalBody("update"),
      ],
      success(),
    );
  }
}

function openPullRequest(number = 42): CommandResult {
  return {
    exitCode: 0,
    stdout: JSON.stringify([{
      number,
      url: `https://github.example.test/team/project-memory/pull/${number}`,
      body: proposalBody("create"),
    }]),
    stderr: "",
  };
}

function noOpenPullRequest(): CommandResult {
  return { exitCode: 0, stdout: "[]", stderr: "" };
}

function addPullRequestDiscovery(runner: ExpectedCommandRunner, results: CommandResult[]): void {
  runner.respondSequence(
    "gh",
    [
      "pr", "list", "--repo", "github.example.test/team/project-memory", "--head", "openmembrane/memory/mem_1",
      "--state", "open", "--json", "number,url,body",
    ],
    results,
  );
}

describe("GitHubTeamService.configure", () => {
  it("returns a safe unavailable result and diagnostic when gh is not installed", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    runner.respond("gh", ["--version"], {
      exitCode: -1,
      stdout: "",
      stderr: "could not run gh with token=super-secret",
      errorCode: "ENOENT",
    });
    const { service, diagnostics } = createService(storageDir, runner);

    await expect(service.configure(configureInput())).resolves.toEqual({
      kind: "rejected",
      code: "GITHUB_CLI_UNAVAILABLE",
      message: "GitHub CLI is unavailable. Install GitHub CLI and try again.",
    });
    expect(diagnostics.events).toMatchObject([
      { code: "GITHUB_CLI_UNAVAILABLE", message: "GitHub CLI is unavailable. Install GitHub CLI and try again." },
    ]);
    expect(JSON.stringify(diagnostics.events)).not.toContain("super-secret");
  });

  it("returns a safe authentication result and diagnostic when gh has no authenticated account", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    runner.respond("gh", ["--version"], success());
    runner.respond("gh", ["auth", "status", "--hostname", "github.example.test"], {
      exitCode: 1,
      stdout: "",
      stderr: "not logged in as token=super-secret",
    });
    const { service, diagnostics } = createService(storageDir, runner);

    await expect(service.configure(configureInput())).resolves.toEqual({
      kind: "rejected",
      code: "GITHUB_AUTH_REQUIRED",
      message: "GitHub CLI is not authenticated for the selected host.",
    });
    expect(diagnostics.events).toMatchObject([{ code: "GITHUB_AUTH_REQUIRED" }]);
    expect(JSON.stringify(diagnostics.events)).not.toContain("super-secret");
  });

  it("rejects a repository that the authenticated user cannot access", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addGitHubChecks(runner, { exitCode: 1, stdout: "", stderr: "HTTP 404" });
    const { service, diagnostics } = createService(storageDir, runner);

    await expect(service.configure(configureInput())).resolves.toEqual({
      kind: "rejected",
      code: "GITHUB_REPOSITORY_UNAVAILABLE",
      message: "The selected GitHub repository is unavailable or cannot be accessed.",
    });
    expect(diagnostics.events).toMatchObject([{ code: "GITHUB_REPOSITORY_UNAVAILABLE" }]);
  });

  it("rejects public repositories before creating a local checkout", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addGitHubChecks(runner, repositoryView({ isPrivate: false }));
    const { service, diagnostics } = createService(storageDir, runner);

    await expect(service.configure(configureInput())).resolves.toEqual({
      kind: "rejected",
      code: "GITHUB_REPOSITORY_NOT_PRIVATE",
      message: "The selected repository must be private.",
    });
    expect(diagnostics.events).toMatchObject([{ code: "GITHUB_REPOSITORY_NOT_PRIVATE" }]);
  });

  it("rejects a non-empty repository without matching OpenMembrane metadata", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addGitHubChecks(runner, repositoryView({ isPrivate: true }));
    addCheckoutCommands(runner, storageDir, "abc123\trefs/heads/main\n");
    const { service, diagnostics } = createService(storageDir, runner);

    await expect(service.configure(configureInput())).resolves.toEqual({
      kind: "rejected",
      code: "GITHUB_REPOSITORY_NOT_INITIALIZED",
      message: "The selected repository is not empty or initialized for this OpenMembrane project.",
    });
    expect(diagnostics.events).toMatchObject([{ code: "GITHUB_REPOSITORY_NOT_INITIALIZED" }]);
  });

  it("configures an empty private repository using host-qualified gh commands and credential-free metadata", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addGitHubChecks(runner, repositoryView({ isPrivate: true }));
    addCheckoutCommands(runner, storageDir, "");
    const { service, diagnostics } = createService(storageDir, runner);

    await expect(service.configure(configureInput())).resolves.toEqual({
      kind: "configured",
      config: {
        projectId: "project-a",
        mode: "github_team",
        repository: {
          host: "github.example.test",
          owner: "team",
          name: "project-memory",
          defaultBranch: "main",
        },
        checkoutPath: join(storageDir, "collaboration", "repos", "project-a"),
        repositoryInitialized: false,
        createdAt: configuredAt,
        updatedAt: configuredAt,
      },
    });
    expect(diagnostics.events).toEqual([]);
    await expect(readFile(join(storageDir, "collaboration", "projects", "project-a.json"), "utf8"))
      .resolves.not.toContain("token");
  });

  it("uses main as the initial branch for an empty private repository without a default branch", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addGitHubChecks(runner, repositoryView({ isPrivate: true, defaultBranch: null }));
    const checkoutPath = join(storageDir, "collaboration", "repos", "project-a");
    runner.respond(
      "git",
      ["clone", "--origin", "origin", "--no-recurse-submodules", "https://github.example.test/team/project-memory", checkoutPath],
      success(),
    );
    runner.respond("git", ["-C", checkoutPath, "ls-remote", "--refs", "origin"], success());
    const { service } = createService(storageDir, runner);

    await expect(service.configure(configureInput())).resolves.toMatchObject({
      kind: "configured",
      config: { repository: { defaultBranch: "main" } },
    });
  });

  it("rejects a tag-only repository without a default branch as non-empty", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addGitHubChecks(runner, repositoryView({ isPrivate: true, defaultBranch: null }));
    const checkoutPath = join(storageDir, "collaboration", "repos", "project-a");
    runner.respond(
      "git",
      ["clone", "--origin", "origin", "--no-recurse-submodules", "https://github.example.test/team/project-memory", checkoutPath],
      success(),
    );
    runner.respond(
      "git",
      ["-C", checkoutPath, "ls-remote", "--refs", "origin"],
      { exitCode: 0, stdout: "abc123\trefs/tags/v1.0.0\n", stderr: "" },
    );
    runner.respond(
      "git",
      ["-C", checkoutPath, "show", "origin/main:.openmembrane/project.json"],
      { exitCode: 1, stdout: "", stderr: "path does not exist" },
    );
    const { service, diagnostics } = createService(storageDir, runner);

    await expect(service.configure(configureInput())).resolves.toEqual({
      kind: "rejected",
      code: "GITHUB_REPOSITORY_NOT_INITIALIZED",
      message: "The selected repository is not empty or initialized for this OpenMembrane project.",
    });
    expect(diagnostics.events).toMatchObject([{ code: "GITHUB_REPOSITORY_NOT_INITIALIZED" }]);
  });

  it("configures a private repository initialized for the selected project", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addGitHubChecks(runner, repositoryView({ isPrivate: true }));
    addCheckoutCommands(
      runner,
      storageDir,
      "abc123\trefs/heads/main\n",
      `${JSON.stringify({ schemaVersion: 1, projectId: "project-a", defaultBranch: "main" })}\n`,
    );
    const { service, diagnostics } = createService(storageDir, runner);

    const result = await service.configure(configureInput());

    expect(result).toMatchObject({
      kind: "configured",
      config: { repository: { host: "github.example.test", owner: "team", name: "project-memory", defaultBranch: "main" } },
    });
    expect(diagnostics.events).toEqual([]);
  });
});

describe("GitHubTeamService proposal publication", () => {
  it("builds a later proposal manifest from the validated merged default-branch snapshot", async () => {
    const storageDir = await createStorageDir();
    const first = sharedMemory();
    const runner = new PublicationRunner(githubProjectConfig(storageDir).checkoutPath, [first]);
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));

    const result = await service.publishAcceptedMemory(acceptedMemory({ id: "mem_2", content: "Use standalone route components." }));
    expect(result, JSON.stringify(runner.commands)).toMatchObject({
      kind: "published",
      proposal: { memory: { id: "mem_2" } },
    });

    expect(JSON.parse(runner.committedManifests[0]?.manifest ?? "{}")).toMatchObject({
      memories: [
        { id: "mem_1" },
        { id: "mem_2" },
      ],
    });
  });

  it("bootstraps an empty repository before fetching its default branch and validates it on later configuration", async () => {
    const storageDir = await createStorageDir();
    const runner = new BootstrapPublicationRunner(githubProjectConfig(storageDir).checkoutPath);
    const { service } = createService(storageDir, runner);

    await expect(service.configure(configureInput())).resolves.toMatchObject({ kind: "configured" });
    await expect(service.publishAcceptedMemory(acceptedMemory())).resolves.toMatchObject({ kind: "published" });
    await expect(service.configure(configureInput())).resolves.toMatchObject({
      kind: "configured",
      config: { repositoryInitialized: true },
    });

    const project = JSON.parse(await readFile(join(githubProjectConfig(storageDir).checkoutPath, ".openmembrane", "project.json"), "utf8"));
    expect(project).toEqual({ schemaVersion: 1, projectId: "project-a", defaultBranch: "main" });
    const commands = runner.commands.map((command) => command.args.join(" "));
    const bootstrapPush = commands.indexOf(`-C ${githubProjectConfig(storageDir).checkoutPath} push origin HEAD:refs/heads/main`);
    const proposalFetch = commands.indexOf(`-C ${githubProjectConfig(storageDir).checkoutPath} fetch origin refs/heads/main:refs/remotes/origin/main`);
    const proposalCheckout = commands.indexOf(`-C ${githubProjectConfig(storageDir).checkoutPath} checkout -B openmembrane/memory/mem_1 origin/main`);
    expect(bootstrapPush).toBeGreaterThan(-1);
    expect(proposalFetch).toBeGreaterThan(bootstrapPush);
    expect(proposalCheckout).toBeGreaterThan(proposalFetch);
  });

  it("creates a supersession proposal by removing the memory from the manifest and proposal branch", async () => {
    const storageDir = await createStorageDir();
    const runner = new PublicationRunner(githubProjectConfig(storageDir).checkoutPath, [sharedMemory()]);
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));

    const memoryDirectory = join(githubProjectConfig(storageDir).checkoutPath, ".openmembrane", "memories");
    await mkdir(memoryDirectory, { recursive: true });
    await writeFile(join(memoryDirectory, "mem_1.json"), "stale proposal file", "utf8");

    await expect(service.supersedeMemory(acceptedMemory())).resolves.toMatchObject({
      kind: "published",
      proposal: { operation: "remove", memory: { id: "mem_1", status: "active" } },
    });

    expect(JSON.parse(runner.committedManifests[0]?.manifest ?? "{}")).toMatchObject({ memories: [] });
    expect(runner.committedManifests[0]?.memoryFiles).not.toContain("mem_1.json");
  });

  it("creates a new proposal branch and pull request after the prior proposal has merged", async () => {
    const storageDir = await createStorageDir();
    const runner = new PublicationRunner(githubProjectConfig(storageDir).checkoutPath, [sharedMemory()]);
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal({
      ...existingOpenProposal(),
      state: "active",
      review: { ...existingOpenProposal().review!, mergedAt: "2026-09-12T12:05:00.000Z", mergedCommit: "merge-sha" },
    });

    await expect(service.updateProposal("mem_1", acceptedMemory({ content: "Use updated standalone components." }))).resolves.toMatchObject({
      kind: "published",
      proposal: { review: { id: "1", branch: "openmembrane/memory/mem_1/2026-09-12T12-00-00-000Z" } },
    });

    expect(runner.commands.map((command) => command.args.join(" "))).not.toContain(expect.stringContaining("pr edit 42"));
  });

  it("serializes concurrent publications for the same checkout", async () => {
    const storageDir = await createStorageDir();
    const runner = new QueuedPublicationRunner(githubProjectConfig(storageDir).checkoutPath);
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));

    const first = service.publishAcceptedMemory(acceptedMemory({ id: "mem_1" }));
    await runner.firstCheckout;
    const second = service.publishAcceptedMemory(acceptedMemory({ id: "mem_2", content: "Second memory." }));
    runner.releaseCheckout();
    await expect(Promise.all([first, second])).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "published" }),
    ]));

    expect(runner.committedManifests.map((commit) => commit.branch)).toEqual([
      "openmembrane/memory/mem_1",
      "openmembrane/memory/mem_2",
    ]);
    expect(runner.committedManifests.map((commit) => JSON.parse(commit.manifest).memories.map((memory: { id: string }) => memory.id)))
      .toEqual([["mem_1"], ["mem_2"]]);
  });

  it("creates a proposed record and pull request without saving accepted memory to the active store", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addPublicationCommands(runner, storageDir, { commitMessage: "memory: propose mem_1", pr: "create" });
    addPullRequestDiscovery(runner, [noOpenPullRequest()]);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));

    await expect(service.publishAcceptedMemory(acceptedMemory())).resolves.toEqual({
      kind: "published",
      proposal: expect.objectContaining({
        projectId: "project-a",
        state: "proposed",
        memory: expect.objectContaining({ id: "mem_1", content: "Use standalone components." }),
        review: {
          provider: "github",
          id: "42",
          url: "https://github.example.test/team/project-memory/pull/42",
          branch: "openmembrane/memory/mem_1",
        },
        retry: { status: "not_scheduled", attempts: 0 },
      }),
    });
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({
      state: "proposed",
      review: { branch: "openmembrane/memory/mem_1", id: "42" },
    });
    await expect(readFile(join(githubProjectConfig(storageDir).checkoutPath, ".openmembrane", "memories", "mem_1.json"), "utf8"))
      .resolves.toContain('"content": "Use standalone components."');
    await expect(readFile(join(githubProjectConfig(storageDir).checkoutPath, ".openmembrane", "manifest.json"), "utf8"))
      .resolves.toContain('"id": "mem_1"');
    await expect(memoryStore.list("project-a")).resolves.toEqual([]);
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "proposal_created", memoryId: "mem_1" }),
      expect.objectContaining({ type: "review_created", memoryId: "mem_1" }),
    ]));
  });

  it("updates the existing unmerged pull request when a proposal memory changes", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addPublicationCommands(runner, storageDir, {
      commitMessage: "memory: update mem_1",
      pr: "update",
      startPoint: "origin/openmembrane/memory/mem_1",
    });
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal({
      projectId: "project-a",
      memory: {
        id: "mem_1",
        projectId: "project-a",
        type: "coding_rule",
        content: "Use an old frontend pattern.",
        scope: "frontend",
        confidence: "high",
        sensitivity: "internal",
        reason: "Original proposal.",
        tags: ["frontend"],
        status: "active",
        createdAt: configuredAt,
        updatedAt: configuredAt,
      },
      state: "proposed",
      review: {
        provider: "github",
        id: "42",
        url: "https://github.example.test/team/project-memory/pull/42",
        branch: "openmembrane/memory/mem_1",
      },
      retry: { status: "not_scheduled", attempts: 0 },
      createdAt: configuredAt,
      updatedAt: configuredAt,
    });

    await expect(service.updateProposal("mem_1", acceptedMemory())).resolves.toMatchObject({
      kind: "published",
      proposal: {
        state: "proposed",
        memory: { content: "Use standalone components." },
        review: { id: "42", branch: "openmembrane/memory/mem_1" },
      },
    });
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "review_updated", memoryId: "mem_1" }),
    ]));
  });

  it("fetches the newly pushed proposal branch before a later update resets from its remote ref", async () => {
    const storageDir = await createStorageDir();
    const config = githubProjectConfig(storageDir);
    const runner = new InitialPublishThenUpdateRunner(config.checkoutPath);
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(config);

    await expect(service.publishAcceptedMemory(acceptedMemory())).resolves.toMatchObject({
      kind: "published",
      proposal: { review: { id: "42" } },
    });
    await expect(service.updateProposal("mem_1", acceptedMemory({ content: "Use updated standalone components." }))).resolves.toMatchObject({
      kind: "published",
      proposal: { review: { id: "42" }, memory: { content: "Use updated standalone components." } },
    });

    expect(runner.commands.map((command) => `${command.executable} ${command.args.join(" ")}`)).toContain(
      `git -C ${config.checkoutPath} fetch origin refs/heads/openmembrane/memory/mem_1:refs/remotes/origin/openmembrane/memory/mem_1`,
    );
  });

  it("updates a proposal branch that has diverged from the default branch", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const checkoutPath = githubProjectConfig(storageDir).checkoutPath;
    runner.respond("git", ["-C", checkoutPath, "fetch", "origin", "refs/heads/openmembrane/memory/mem_1:refs/remotes/origin/openmembrane/memory/mem_1"], success());
    runner.respond("git", ["-C", checkoutPath, "checkout", "-B", "openmembrane/memory/mem_1", "origin/openmembrane/memory/mem_1"], success());
    runner.respond("git", ["-C", checkoutPath, "add", "--", ".openmembrane"], success());
    runner.respond("git", ["-C", checkoutPath, "commit", "-m", "memory: update mem_1"], success());
    runner.respond("git", ["-C", checkoutPath, "push", "origin", "HEAD:refs/heads/openmembrane/memory/mem_1"], success());
    runner.respond(
      "gh",
      [
        "pr", "edit", "42", "--repo", "github.example.test/team/project-memory", "--base", "main",
        "--title", "memory: update mem_1", "--body", proposalBody("update"),
      ],
      success(),
    );
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal(existingOpenProposal());

    await expect(service.updateProposal("mem_1", acceptedMemory())).resolves.toMatchObject({
      kind: "published",
      proposal: { review: { id: "42", branch: "openmembrane/memory/mem_1" } },
    });
  });

  it("discovers and persists an existing PR after an ambiguous create outcome before retrying", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addPublicationCommands(runner, storageDir, { commitMessage: "memory: propose mem_1", pr: "create" });
    runner.respondSequence(
      "gh",
      [
        "pr", "create", "--repo", "github.example.test/team/project-memory", "--base", "main", "--head", "openmembrane/memory/mem_1",
        "--title", "memory: propose mem_1", "--body", proposalBody("create"),
      ],
      [{ exitCode: 1, stdout: "", stderr: "connection reset after creation" }],
    );
    addPullRequestDiscovery(runner, [noOpenPullRequest(), openPullRequest()]);
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));

    await expect(service.publishAcceptedMemory(acceptedMemory())).resolves.toMatchObject({
      kind: "published",
      proposal: { state: "proposed", review: { id: "42", branch: "openmembrane/memory/mem_1" } },
    });
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({
      state: "proposed",
      review: { id: "42" },
    });
  });

  it("discovers the created PR after local persistence fails and updates it on retry", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addPublicationCommands(runner, storageDir, { commitMessage: "memory: propose mem_1", pr: "create" });
    addPullRequestDiscovery(runner, [noOpenPullRequest(), openPullRequest()]);
    runner.respond(
      "git",
      ["-C", githubProjectConfig(storageDir).checkoutPath, "fetch", "origin", "refs/heads/openmembrane/memory/mem_1:refs/remotes/origin/openmembrane/memory/mem_1"],
      success(),
    );
    runner.respond("git", ["-C", githubProjectConfig(storageDir).checkoutPath, "checkout", "-B", "openmembrane/memory/mem_1", "origin/openmembrane/memory/mem_1"], success());
    runner.respondSequence("git", ["-C", githubProjectConfig(storageDir).checkoutPath, "add", "--", ".openmembrane"], [success(), success()]);
    runner.respond("git", ["-C", githubProjectConfig(storageDir).checkoutPath, "commit", "-m", "memory: update mem_1"], success());
    runner.respondSequence(
      "git",
      ["-C", githubProjectConfig(storageDir).checkoutPath, "push", "origin", "HEAD:refs/heads/openmembrane/memory/mem_1"],
      [success(), success()],
    );
    runner.respond(
      "gh",
      [
        "pr", "edit", "42", "--repo", "github.example.test/team/project-memory", "--base", "main",
        "--title", "memory: update mem_1", "--body", proposalBody("update"),
      ],
      success(),
    );
    let timestamp = "2026-09-12T12:00:00.000Z";
    const baseStore = new JsonCollaborationStore(storageDir);
    const { service } = createService(storageDir, runner, undefined, () => timestamp);
    const persistenceFailingService = new GitHubTeamService({
      collaborationStore: new FailOnceProposalStore(baseStore, 2),
      memoryStore: new JsonMemoryStore(storageDir),
      diagnosticsLogStore: new InMemoryDiagnosticsLogStore(),
      github: new GitHubCli(runner),
      storageDir,
      now: () => timestamp,
    });
    await baseStore.saveProjectConfig(githubProjectConfig(storageDir));

    await expect(persistenceFailingService.publishAcceptedMemory(acceptedMemory())).resolves.toMatchObject({ kind: "retry_scheduled" });
    timestamp = "2026-09-12T12:01:00.000Z";
    await expect(service.publishAcceptedMemory(acceptedMemory())).resolves.toMatchObject({
      kind: "published",
      proposal: { review: { id: "42" } },
    });
  });

  it("schedules a bounded exponential retry after a safe publication failure and does not retry early", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const checkoutPath = githubProjectConfig(storageDir).checkoutPath;
    addPullRequestDiscovery(runner, [noOpenPullRequest(), noOpenPullRequest(), noOpenPullRequest(), noOpenPullRequest(), noOpenPullRequest(), noOpenPullRequest(), noOpenPullRequest()]);
    runner.respond("git", ["-C", checkoutPath, "checkout", "-B", "openmembrane/memory/mem_1", "origin/main"], {
      exitCode: 1,
      stdout: "",
      stderr: "authentication token=super-secret failed",
    });
    let timestamp = "2026-09-12T12:00:00.000Z";
    const { service, collaborationStore, diagnostics } = createService(storageDir, runner, undefined, () => timestamp);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));

    await expect(service.publishAcceptedMemory(acceptedMemory())).resolves.toEqual({
      kind: "retry_scheduled",
      code: "GITHUB_PUBLICATION_FAILED",
      nextAttemptAt: "2026-09-12T12:01:00.000Z",
    });
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({
      state: "sync_failed",
      retry: {
        status: "scheduled",
        attempts: 1,
        lastAttemptAt: "2026-09-12T12:00:00.000Z",
        nextAttemptAt: "2026-09-12T12:01:00.000Z",
        failureCode: "GITHUB_PUBLICATION_FAILED",
      },
    });
    expect(JSON.stringify(diagnostics.events)).not.toContain("super-secret");

    timestamp = "2026-09-12T12:00:30.000Z";
    await expect(service.publishAcceptedMemory(acceptedMemory())).resolves.toEqual({
      kind: "retry_deferred",
      nextAttemptAt: "2026-09-12T12:01:00.000Z",
    });
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({
      retry: { attempts: 1, nextAttemptAt: "2026-09-12T12:01:00.000Z" },
    });

    timestamp = "2026-09-12T12:01:00.000Z";
    await expect(service.publishAcceptedMemory(acceptedMemory())).resolves.toEqual({
      kind: "retry_scheduled",
      code: "GITHUB_PUBLICATION_FAILED",
      nextAttemptAt: "2026-09-12T12:03:00.000Z",
    });

    for (const [attemptAt, nextAttemptAt] of [
      ["2026-09-12T12:03:00.000Z", "2026-09-12T12:07:00.000Z"],
      ["2026-09-12T12:07:00.000Z", "2026-09-12T12:15:00.000Z"],
      ["2026-09-12T12:15:00.000Z", "2026-09-12T12:31:00.000Z"],
      ["2026-09-12T12:31:00.000Z", "2026-09-12T13:03:00.000Z"],
      ["2026-09-12T13:03:00.000Z", "2026-09-12T14:03:00.000Z"],
    ] as const) {
      timestamp = attemptAt;
      await expect(service.publishAcceptedMemory(acceptedMemory())).resolves.toEqual({
        kind: "retry_scheduled",
        code: "GITHUB_PUBLICATION_FAILED",
        nextAttemptAt,
      });
    }
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({
      retry: { attempts: 7, nextAttemptAt: "2026-09-12T14:03:00.000Z" },
    });
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "retry_scheduled", memoryId: "mem_1" }),
    ]));
  });
});

function mergedPullRequest(): CommandResult {
  return pullRequestView({ state: "MERGED", mergedAt: "2026-09-12T12:05:00.000Z", mergeCommit: "merge-sha" });
}

function closedPullRequest(): CommandResult {
  return pullRequestView({
    state: "CLOSED",
    closedAt: "2026-09-12T12:05:00.000Z",
    closedBy: "octocat",
  });
}

function changesRequestedPullRequest(): CommandResult {
  return pullRequestView({ state: "OPEN", reviewDecision: "CHANGES_REQUESTED" });
}

function pullRequestView(input: {
  state: "OPEN" | "CLOSED" | "MERGED";
  mergedAt?: string;
  mergeCommit?: string;
  closedAt?: string;
  closedBy?: string;
  reviewDecision?: "CHANGES_REQUESTED";
}): CommandResult {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      number: 42,
      url: "https://github.example.test/team/project-memory/pull/42",
      state: input.state,
      mergedAt: input.mergedAt ?? null,
      mergeCommit: input.mergeCommit === undefined ? null : { oid: input.mergeCommit },
      closedAt: input.closedAt ?? null,
      closedBy: input.closedBy === undefined ? null : { login: input.closedBy },
      reviewDecision: input.reviewDecision ?? null,
    }),
    stderr: "",
  };
}

function sharedMemory(overrides: Partial<CollaborationProposal["memory"]> = {}): CollaborationProposal["memory"] {
  const { source: _source, ...memory } = acceptedMemory();
  return { ...memory, ...overrides };
}

function addFullRefreshCommands(
  runner: ExpectedCommandRunner,
  storageDir: string,
  memories: readonly CollaborationProposal["memory"][],
): void {
  const config = githubProjectConfig(storageDir);
  const files = memories.map((memory) => ({
    path: `.openmembrane/memories/${memory.id}.json`,
    content: `${JSON.stringify(memory, null, 2)}\n`,
  }));
  const manifest = `${JSON.stringify({
    schemaVersion: 1,
    projectId: "project-a",
    defaultBranch: "main",
    generatedAt: configuredAt,
    memories: files.map((file) => ({
      id: file.path.slice(".openmembrane/memories/".length, -".json".length),
      contentHash: createHash("sha256").update(file.content).digest("hex"),
    })),
  }, null, 2)}\n`;
  runner.respond(
    "git",
    ["-C", config.checkoutPath, "fetch", "origin", "refs/heads/main:refs/remotes/origin/main"],
    success(),
  );
  runner.respond("git", ["-C", config.checkoutPath, "rev-parse", "origin/main"], {
    exitCode: 0,
    stdout: "abcdef0\n",
    stderr: "",
  });
  runner.respond("git", ["-C", config.checkoutPath, "show", "origin/main:.openmembrane/manifest.json"], {
    exitCode: 0,
    stdout: manifest,
    stderr: "",
  });
  for (const file of files) {
    runner.respond("git", ["-C", config.checkoutPath, "show", `origin/main:${file.path}`], {
      exitCode: 0,
      stdout: file.content,
      stderr: "",
    });
  }
}

function addRefreshTransport(
  runner: ExpectedCommandRunner,
  storageDir: string,
  manifests: readonly string[],
): void {
  const checkoutPath = githubProjectConfig(storageDir).checkoutPath;
  runner.respondSequence(
    "git",
    ["-C", checkoutPath, "fetch", "origin", "refs/heads/main:refs/remotes/origin/main"],
    manifests.map(() => success()),
  );
  runner.respondSequence(
    "git",
    ["-C", checkoutPath, "rev-parse", "origin/main"],
    manifests.map(() => ({ exitCode: 0, stdout: "abcdef0\n", stderr: "" })),
  );
  runner.respondSequence(
    "git",
    ["-C", checkoutPath, "show", "origin/main:.openmembrane/manifest.json"],
    manifests.map((stdout) => ({ exitCode: 0, stdout, stderr: "" })),
  );
}

function manifest(memories: readonly { id: string; contentHash: string }[]): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    projectId: "project-a",
    defaultBranch: "main",
    generatedAt: configuredAt,
    memories,
  }, null, 2)}\n`;
}

function remoteFile(memory: CollaborationProposal["memory"]): { path: string; content: string; contentHash: string } {
  const content = `${JSON.stringify(memory, null, 2)}\n`;
  return {
    path: `.openmembrane/memories/${memory.id}.json`,
    content,
    contentHash: createHash("sha256").update(content).digest("hex"),
  };
}

function addIncrementalRefreshCommands(
  runner: ExpectedCommandRunner,
  storageDir: string,
  previousCommit: string,
  memories: readonly CollaborationProposal["memory"][],
): void {
  addFullRefreshCommands(runner, storageDir, memories);
  runner.respond(
    "git",
    [
      "-C", githubProjectConfig(storageDir).checkoutPath, "diff", "--name-status", previousCommit, "abcdef0", "--",
      ".openmembrane/manifest.json", ".openmembrane/memories",
    ],
    { exitCode: 0, stdout: memories.map((memory) => `M\t.openmembrane/memories/${memory.id}.json`).join("\n"), stderr: "" },
  );
}

function addPullRequestInspection(runner: ExpectedCommandRunner, result: CommandResult): void {
  runner.respond(
    "gh",
    [
      "pr", "view", "42", "--repo", "github.example.test/team/project-memory",
      "--json", "number,url,state,mergedAt,mergeCommit,closedAt,closedBy,reviewDecision",
    ],
    result,
  );
}

describe("GitHubTeamService refreshBeforeRetrieval", () => {
  it("publishes a replacement proposal that removes conflicting default-branch memories in the same change", async () => {
    const storageDir = await createStorageDir();
    const replaced = sharedMemory({ id: "mem_old", content: "Use pnpm for package management." });
    const replacement = acceptedMemory({ id: "mem_new", content: "Use yarn for package management." });
    const runner = new PublicationRunner(githubProjectConfig(storageDir).checkoutPath, [replaced]);
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    const oldPath = join(githubProjectConfig(storageDir).checkoutPath, ".openmembrane", "memories", "mem_old.json");
    await mkdir(join(githubProjectConfig(storageDir).checkoutPath, ".openmembrane", "memories"), { recursive: true });
    await writeFile(oldPath, remoteFile(replaced).content, "utf8");

    await expect(service.publishAcceptedMemory(replacement, ["mem_old"])).resolves.toMatchObject({
      kind: "published",
      proposal: { removalMemoryIds: ["mem_old"] },
    });

    const committed = runner.committedManifests[0];
    expect(committed?.manifest).toContain("mem_new");
    expect(committed?.manifest).not.toContain("mem_old");
    expect(committed?.memoryFiles).toContain("mem_new.json");
    expect(committed?.memoryFiles).not.toContain("mem_old.json");
    await expect(readFile(oldPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes an imported conflict after its replacement proposal merges", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const replacement = sharedMemory({ id: "mem_new", content: "Use yarn for package management." });
    addPullRequestInspection(runner, mergedPullRequest());
    addFullRefreshCommands(runner, storageDir, [replacement]);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await memoryStore.save({ ...acceptedMemory({ id: "mem_old", content: "Use pnpm for package management." }), source: { kind: "import", tool: "github" } });
    await collaborationStore.saveProposal({
      ...existingOpenProposal(),
      memory: replacement,
      removalMemoryIds: ["mem_old"],
    });

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_old")).resolves.toMatchObject({ status: "superseded" });
    await expect(memoryStore.findById("project-a", "mem_new")).resolves.toMatchObject({ status: "active", source: { kind: "import", tool: "github" } });
  });

  it("imports a merged replacement over its superseded local proposal staging record", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const replacement = sharedMemory({ id: "mem_new", content: "Use yarn for package management." });
    addPullRequestInspection(runner, mergedPullRequest());
    addFullRefreshCommands(runner, storageDir, [replacement]);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await memoryStore.save({ ...acceptedMemory({ id: "mem_old", content: "Use pnpm for package management." }), source: { kind: "import", tool: "github" } });
    await memoryStore.save(acceptedMemory({ id: "mem_new", content: "Use yarn for package management." }));
    await memoryStore.supersede("project-a", "mem_new");
    await collaborationStore.saveProposal({
      ...existingOpenProposal(),
      memory: replacement,
      removalMemoryIds: ["mem_old"],
    });

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.list("project-a")).resolves.toEqual([
      expect.objectContaining({ id: "mem_new", status: "active", source: { kind: "import", tool: "github" } }),
    ]);
    await expect(memoryStore.findById("project-a", "mem_old")).resolves.toMatchObject({ status: "superseded" });
    await expect(collaborationStore.getProposal("project-a", "mem_new")).resolves.toMatchObject({ state: "active" });
  });

  it("activates a merged proposal only after importing its validated default-branch entry", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const remoteMemory = sharedMemory();
    addPullRequestInspection(runner, mergedPullRequest());
    addFullRefreshCommands(runner, storageDir, [remoteMemory]);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal(existingOpenProposal());

    await service.refreshBeforeRetrieval("project-a");

    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({
      state: "active",
      review: { mergedAt: "2026-09-12T12:05:00.000Z", mergedCommit: "merge-sha" },
    });
    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({
      content: "Use standalone components.",
      source: { kind: "import", tool: "github" },
    });
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "review_merged", memoryId: "mem_1" }),
      expect.objectContaining({ type: "memory_imported", memoryId: "mem_1" }),
    ]));
  });

  it("does not activate a merged proposal when its default-branch entry is absent", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addPullRequestInspection(runner, mergedPullRequest());
    addFullRefreshCommands(runner, storageDir, []);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal(existingOpenProposal());

    await service.refreshBeforeRetrieval("project-a");

    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({ state: "proposed" });
    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toBeUndefined();
  });

  it("retains the checkpoint and retries a full snapshot before activating a merged proposal", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const file = remoteFile(sharedMemory());
    addRefreshTransport(runner, storageDir, ["{", manifest([{ id: "mem_1", contentHash: file.contentHash }])]);
    runner.respond("git", ["-C", githubProjectConfig(storageDir).checkoutPath, "show", `origin/main:${file.path}`], {
      exitCode: 0,
      stdout: file.content,
      stderr: "",
    });
    addPullRequestInspection(runner, mergedPullRequest());
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal(existingOpenProposal());

    await service.refreshBeforeRetrieval("project-a");
    await expect(collaborationStore.getCheckpoint("project-a")).resolves.toBeUndefined();
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({ state: "proposed" });

    await service.refreshBeforeRetrieval("project-a");

    await expect(collaborationStore.getCheckpoint("project-a")).resolves.toMatchObject({ defaultBranchCommit: "abcdef0" });
    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({ id: "mem_1" });
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({ state: "active" });
  });

  it("quarantines a manifest hash mismatch without importing or activating a merged proposal", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const expected = remoteFile(sharedMemory());
    const altered = remoteFile(sharedMemory({ content: "Altered after manifest generation." }));
    addRefreshTransport(runner, storageDir, [manifest([{ id: "mem_1", contentHash: expected.contentHash }])]);
    runner.respond("git", ["-C", githubProjectConfig(storageDir).checkoutPath, "show", `origin/main:${altered.path}`], {
      exitCode: 0,
      stdout: altered.content,
      stderr: "",
    });
    addPullRequestInspection(runner, mergedPullRequest());
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal(existingOpenProposal());

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toBeUndefined();
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({ state: "proposed" });
    await expect(collaborationStore.getCheckpoint("project-a")).resolves.toBeUndefined();
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "memory_quarantined", memoryId: "mem_1" }),
    ]));
  });

  it("rejects a closed unmerged proposal with GitHub close metadata", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addPullRequestInspection(runner, closedPullRequest());
    addFullRefreshCommands(runner, storageDir, []);
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal(existingOpenProposal());

    await service.refreshBeforeRetrieval("project-a");

    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({
      state: "rejected",
      review: { closedAt: "2026-09-12T12:05:00.000Z", closedBy: "octocat" },
    });
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "review_closed", memoryId: "mem_1" }),
    ]));
  });

  it("preserves a conflict recorded during import when its pull request is closed", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addPullRequestInspection(runner, closedPullRequest());
    addFullRefreshCommands(runner, storageDir, [sharedMemory({ content: "Remote value." })]);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal(existingOpenProposal());
    await memoryStore.save(acceptedMemory({ content: "Last known good local value." }));

    await service.refreshBeforeRetrieval("project-a");

    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({ state: "conflict" });
  });

  it("retains a proposed record when GitHub reports requested changes", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addPullRequestInspection(runner, changesRequestedPullRequest());
    addFullRefreshCommands(runner, storageDir, []);
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal(existingOpenProposal());

    await service.refreshBeforeRetrieval("project-a");

    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({ state: "proposed" });
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "review_changes_requested", memoryId: "mem_1" }),
    ]));
  });

  it("quarantines an invalid remote entry while importing valid peers", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const validMemory = sharedMemory();
    const invalidMemory = sharedMemory({ id: "mem_2", content: "token=super-secret" });
    addFullRefreshCommands(runner, storageDir, [validMemory, invalidMemory]);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({ id: "mem_1" });
    await expect(memoryStore.findById("project-a", "mem_2")).resolves.toBeUndefined();
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "memory_quarantined", memoryId: "mem_2" }),
    ]));
  });

  it("removes an active shared entry when it is deleted from the remote snapshot", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addFullRefreshCommands(runner, storageDir, []);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await memoryStore.save({ ...acceptedMemory(), source: { kind: "import", tool: "github" } });

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({ status: "superseded" });
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "memory_removed", memoryId: "mem_1" }),
    ]));
  });

  it("fully rebuilds and removes an imported memory when a changed manifest no longer declares it", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addRefreshTransport(runner, storageDir, [manifest([])]);
    runner.respond(
      "git",
      [
        "-C", githubProjectConfig(storageDir).checkoutPath, "diff", "--name-status", "1234567", "abcdef0", "--",
        ".openmembrane/manifest.json", ".openmembrane/memories",
      ],
      { exitCode: 0, stdout: "M\t.openmembrane/manifest.json\nD\t.openmembrane/memories/mem_1.json", stderr: "" },
    );
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveCheckpoint({ projectId: "project-a", defaultBranchCommit: "1234567", syncedAt: configuredAt });
    await memoryStore.save({ ...acceptedMemory(), source: { kind: "import", tool: "github" } });

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({ status: "superseded" });
    await expect(collaborationStore.getCheckpoint("project-a")).resolves.toMatchObject({ defaultBranchCommit: "abcdef0" });
  });

  it("quarantines a manifest-declared memory whose file is missing without advancing the checkpoint", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const remoteMemory = remoteFile(sharedMemory());
    addRefreshTransport(runner, storageDir, [manifest([{ id: "mem_1", contentHash: remoteMemory.contentHash }])]);
    runner.respond(
      "git",
      [
        "-C", githubProjectConfig(storageDir).checkoutPath, "diff", "--name-status", "1234567", "abcdef0", "--",
        ".openmembrane/manifest.json", ".openmembrane/memories",
      ],
      { exitCode: 0, stdout: "D\t.openmembrane/memories/mem_1.json", stderr: "" },
    );
    runner.respond("git", ["-C", githubProjectConfig(storageDir).checkoutPath, "show", `origin/main:${remoteMemory.path}`], {
      exitCode: 1,
      stdout: "",
      stderr: "not found",
    });
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveCheckpoint({ projectId: "project-a", defaultBranchCommit: "1234567", syncedAt: configuredAt });
    await memoryStore.save({ ...acceptedMemory(), source: { kind: "import", tool: "github" } });

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({ status: "active" });
    await expect(collaborationStore.getCheckpoint("project-a")).resolves.toMatchObject({ defaultBranchCommit: "1234567" });
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "memory_quarantined", memoryId: "mem_1" }),
    ]));
  });

  it("activates a merged supersession only after the default-branch removal is reconciled", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addPullRequestInspection(runner, mergedPullRequest());
    addFullRefreshCommands(runner, storageDir, []);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await memoryStore.save({ ...acceptedMemory(), source: { kind: "import", tool: "github" } });
    await collaborationStore.saveProposal({ ...existingOpenProposal(), operation: "remove" } as CollaborationProposal);

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({ status: "superseded" });
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({ state: "active", operation: "remove" });
  });

  it("records a conflict without overwriting a locally active last-known-good entry", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addFullRefreshCommands(runner, storageDir, [sharedMemory({ content: "Remote value." })]);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await memoryStore.save(acceptedMemory({ content: "Last known good local value." }));

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({ content: "Last known good local value." });
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({ state: "conflict" });
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "memory_conflicted", memoryId: "mem_1" }),
    ]));
  });

  it("preserves proposal review, retry, timestamps, and proposed snapshot when recording a conflict", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addFullRefreshCommands(runner, storageDir, [sharedMemory({ content: "Remote value." })]);
    addPullRequestInspection(runner, pullRequestView({ state: "OPEN" }));
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal({
      ...existingOpenProposal(),
      retry: { status: "scheduled", attempts: 2, lastAttemptAt: "2026-09-12T12:01:00.000Z", nextAttemptAt: "2026-09-12T12:03:00.000Z", failureCode: "GITHUB_PUBLICATION_FAILED" },
      createdAt: "2026-09-12T11:00:00.000Z",
    });
    await memoryStore.save(acceptedMemory({ content: "Last known good local value." }));

    await service.refreshBeforeRetrieval("project-a");

    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({
      state: "conflict",
      memory: { content: "Use an old frontend pattern." },
      review: { id: "42", branch: "openmembrane/memory/mem_1" },
      retry: { status: "scheduled", attempts: 2, nextAttemptAt: "2026-09-12T12:03:00.000Z" },
      createdAt: "2026-09-12T11:00:00.000Z",
      updatedAt: configuredAt,
    });
  });

  it("preserves conflict state when a merged proposal diverges from local active content", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addPullRequestInspection(runner, mergedPullRequest());
    addFullRefreshCommands(runner, storageDir, [sharedMemory({ content: "Remote value." })]);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveProposal(existingOpenProposal());
    await memoryStore.save(acceptedMemory({ content: "Last known good local value." }));

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({ content: "Last known good local value." });
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({ state: "conflict" });
  });

  it("quarantines duplicate manifest IDs deterministically before importing peers", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const duplicate = remoteFile(sharedMemory());
    const peer = remoteFile(sharedMemory({ id: "mem_2", content: "Peer memory." }));
    addRefreshTransport(runner, storageDir, [manifest([
      { id: "mem_1", contentHash: duplicate.contentHash },
      { id: "mem_1", contentHash: duplicate.contentHash },
      { id: "mem_2", contentHash: peer.contentHash },
    ])]);
    runner.respond("git", ["-C", githubProjectConfig(storageDir).checkoutPath, "show", `origin/main:${peer.path}`], {
      exitCode: 0,
      stdout: peer.content,
      stderr: "",
    });
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toBeUndefined();
    await expect(memoryStore.findById("project-a", "mem_2")).resolves.toMatchObject({ id: "mem_2" });
    await expect(collaborationStore.getCheckpoint("project-a")).resolves.toBeUndefined();
    await expect(collaborationStore.listEvents("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "memory_quarantined", memoryId: "mem_1" }),
    ]));
  });

  it("uses only read-only GitHub operations before retrieval", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addFullRefreshCommands(runner, storageDir, [sharedMemory()]);
    const { service, collaborationStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));

    await service.refreshBeforeRetrieval("project-a");

    expect(runner.commands.filter((command) => command.executable === "gh" && ["create", "edit"].includes(command.args[1] ?? ""))).toEqual([]);
    expect(runner.commands.filter((command) => command.executable === "git" && ["add", "commit", "push", "checkout"].includes(command.args[2] ?? ""))).toEqual([]);
  });

  it("imports only changed entries after a valid checkpoint", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addIncrementalRefreshCommands(runner, storageDir, "1234567", [sharedMemory()]);
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveCheckpoint({ projectId: "project-a", defaultBranchCommit: "1234567", syncedAt: configuredAt });

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({ id: "mem_1" });
    await expect(collaborationStore.getCheckpoint("project-a")).resolves.toMatchObject({ defaultBranchCommit: "abcdef0" });
  });

  it("rebuilds every entry when a changed manifest corrupts an unchanged merged memory hash", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    const memoryA = remoteFile(sharedMemory());
    const memoryB = remoteFile(sharedMemory({ id: "mem_2", content: "Changed memory B." }));
    addRefreshTransport(runner, storageDir, [manifest([
      { id: "mem_1", contentHash: "0".repeat(64) },
      { id: "mem_2", contentHash: memoryB.contentHash },
    ])]);
    runner.respond(
      "git",
      [
        "-C", githubProjectConfig(storageDir).checkoutPath, "diff", "--name-status", "1234567", "abcdef0", "--",
        ".openmembrane/manifest.json", ".openmembrane/memories",
      ],
      { exitCode: 0, stdout: "M\t.openmembrane/manifest.json\nM\t.openmembrane/memories/mem_2.json", stderr: "" },
    );
    runner.respond("git", ["-C", githubProjectConfig(storageDir).checkoutPath, "show", `origin/main:${memoryA.path}`], {
      exitCode: 0,
      stdout: memoryA.content,
      stderr: "",
    });
    runner.respond("git", ["-C", githubProjectConfig(storageDir).checkoutPath, "show", `origin/main:${memoryB.path}`], {
      exitCode: 0,
      stdout: memoryB.content,
      stderr: "",
    });
    addPullRequestInspection(runner, mergedPullRequest());
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveCheckpoint({ projectId: "project-a", defaultBranchCommit: "1234567", syncedAt: configuredAt });
    await collaborationStore.saveProposal(existingOpenProposal());

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toBeUndefined();
    await expect(memoryStore.findById("project-a", "mem_2")).resolves.toMatchObject({ id: "mem_2" });
    await expect(collaborationStore.getProposal("project-a", "mem_1")).resolves.toMatchObject({ state: "proposed" });
    await expect(collaborationStore.getCheckpoint("project-a")).resolves.toMatchObject({ defaultBranchCommit: "1234567" });
  });

  it("rebuilds from the full validated snapshot when checkpoint history cannot be inspected", async () => {
    const storageDir = await createStorageDir();
    const runner = new ExpectedCommandRunner();
    addFullRefreshCommands(runner, storageDir, [sharedMemory()]);
    runner.respond(
      "git",
      [
        "-C", githubProjectConfig(storageDir).checkoutPath, "diff", "--name-status", "1234567", "abcdef0", "--",
        ".openmembrane/manifest.json", ".openmembrane/memories",
      ],
      { exitCode: 128, stdout: "", stderr: "invalid revision range" },
    );
    const { service, collaborationStore, memoryStore } = createService(storageDir, runner);
    await collaborationStore.saveProjectConfig(githubProjectConfig(storageDir));
    await collaborationStore.saveCheckpoint({ projectId: "project-a", defaultBranchCommit: "1234567", syncedAt: configuredAt });

    await service.refreshBeforeRetrieval("project-a");

    await expect(memoryStore.findById("project-a", "mem_1")).resolves.toMatchObject({ id: "mem_1" });
  });
});
