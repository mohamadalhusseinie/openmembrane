import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenMembraneContext } from "../apps/mcp-server/src/context";
import { safeJsonResult } from "../apps/mcp-server/src/server";
import { createToolHandlers } from "../apps/mcp-server/src/tools/handlers";
import { SessionNudgeTracker } from "../apps/mcp-server/src/nudge";
import type { Command, CommandResult, CommandRunner } from "../apps/mcp-server/src/collaboration/GitHubCli";
import { candidate, entry } from "./unit/helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

class GitHubModeRunner implements CommandRunner {
  readonly commands: Command[] = [];
  readonly observedPublicationResponseStates: boolean[] = [];
  responseConstructed = false;

  async run(command: Command): Promise<CommandResult> {
    this.commands.push(command);
    if (command.executable === "gh" && command.args[0] === "--version") {
      return { exitCode: 0, stdout: "gh version 2.0.0", stderr: "" };
    }
    if (command.executable === "gh" && command.args[0] === "auth") {
      return { exitCode: 0, stdout: "", stderr: "authenticated token=super-secret" };
    }
    if (command.executable === "gh" && command.args[0] === "repo") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          nameWithOwner: "team/project-memory",
          isPrivate: true,
          defaultBranch: { name: "main" },
          url: "https://github.example.test/team/project-memory",
        }),
        stderr: "",
      };
    }
    if (command.executable === "gh" && command.args[0] === "pr" && command.args[1] === "list") {
      return { exitCode: 0, stdout: "[]", stderr: "" };
    }
    if (command.executable === "gh" && command.args[0] === "pr" && command.args[1] === "create") {
      return { exitCode: 0, stdout: "https://github.example.test/team/project-memory/pull/42\n", stderr: "" };
    }
    if (command.executable === "git" && command.args.includes("rev-parse")) {
      return { exitCode: 0, stdout: "abcdef0\n", stderr: "" };
    }
    if (command.executable === "git" && command.args.includes("fetch")) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command.executable === "git" && command.args.includes("show")) {
      if (command.args.some((arg) => arg.endsWith(":.openmembrane/project.json"))) {
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({ schemaVersion: 1, projectId: "project-a", defaultBranch: "main" })}\n`,
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: "remote output token=super-secret" };
    }
    if (command.executable === "git") {
      if (command.args.includes("checkout")) this.observedPublicationResponseStates.push(this.responseConstructed);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected command: ${command.executable} ${command.args.join(" ")}`);
  }
}

class MergedProposalRunner extends GitHubModeRunner {
  override async run(command: Command): Promise<CommandResult> {
    if (command.executable === "gh" && command.args[0] === "pr" && command.args[1] === "view") {
      this.commands.push(command);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          number: 42,
          url: "https://github.example.test/team/project-memory/pull/42",
          state: "MERGED",
          mergedAt: "2026-09-12T12:05:00.000Z",
          mergeCommit: { oid: "merge-sha" },
          closedAt: null,
          closedBy: null,
          reviewDecision: null,
        }),
        stderr: "",
      };
    }
    return super.run(command);
  }
}

class RefreshingGitHubModeRunner extends GitHubModeRunner {
  constructor(private readonly remoteMemories: readonly Record<string, unknown>[]) {
    super();
  }

  override async run(command: Command): Promise<CommandResult> {
    if (command.executable === "git" && command.args.includes("show")) {
      const remotePath = command.args.find((arg) => arg.startsWith("origin/main:"))?.slice("origin/main:".length);
      if (remotePath === ".openmembrane/manifest.json") {
        const files = this.remoteMemories.map((memory) => `${JSON.stringify(memory, null, 2)}\n`);
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({
            schemaVersion: 1,
            projectId: "project-a",
            defaultBranch: "main",
            generatedAt: "2026-09-12T12:00:00.000Z",
            memories: this.remoteMemories.map((memory, index) => ({
              id: memory.id,
              contentHash: createHash("sha256").update(files[index] ?? "").digest("hex"),
            })),
          }, null, 2)}\n`,
          stderr: "",
        };
      }
      const memory = this.remoteMemories.find((item) => `.openmembrane/memories/${item.id}.json` === remotePath);
      if (memory !== undefined) return { exitCode: 0, stdout: `${JSON.stringify(memory, null, 2)}\n`, stderr: "" };
    }
    return super.run(command);
  }
}

async function createHandlers(options: { githubRunner?: CommandRunner } = {}) {
  const storageDir = await mkdtemp(join(tmpdir(), "openmembrane-mcp-test-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "openmembrane-project-test-"));
  tempDirs.push(storageDir, projectRoot);

  const context = await createOpenMembraneContext({
    defaultProjectId: "project-a",
    projectRoot,
    storageDir,
    ...options,
  });

  return {
    context,
    handlers: createToolHandlers(context),
    projectRoot
  };
}

async function configureGitHubMode(handlers: ReturnType<typeof createToolHandlers>): Promise<void> {
  await handlers.configureGitHubTeamMode({
    repository: { host: "github.example.test", owner: "team", name: "project-memory" },
  });
}

async function saveStaleMergedProposal(
  context: Awaited<ReturnType<typeof createHandlers>>["context"],
  memoryId: string,
): Promise<void> {
  const memory = entry({
    id: memoryId,
    content: "Use pnpm for package management.",
    source: { kind: "import", tool: "github" },
  });
  await context.memoryStore.save(memory);
  await context.collaborationStore.saveProposal({
    projectId: "project-a",
    memory: { ...memory, source: undefined } as never,
    state: "proposed",
    review: {
      provider: "github",
      id: "42",
      url: "https://github.example.test/team/project-memory/pull/42",
      branch: `openmembrane/memory/${memoryId}`,
    },
    retry: { status: "not_scheduled", attempts: 0 },
    createdAt: "2026-09-12T12:00:00.000Z",
    updatedAt: "2026-09-12T12:00:00.000Z",
  });
}

function rejectMemorySavedAuditWrites(
  context: Awaited<ReturnType<typeof createHandlers>>["context"],
): void {
  const append = context.auditLogStore.append.bind(context.auditLogStore);
  context.auditLogStore.append = async (event) => {
    if (event.type === "memory_saved") throw new Error("simulated audit write failure");
    await append(event);
  };
}

describe("MCP tool handlers", () => {
  it("configures GitHub Team mode with a validated private repository", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });

    const result = await handlers.configureGitHubTeamMode({
      repository: { host: "github.example.test", owner: "team", name: "project-memory" },
    });

    expect(result).toMatchObject({
      kind: "configured",
      config: {
        projectId: "project-a",
        mode: "github_team",
        repository: { host: "github.example.test", owner: "team", name: "project-memory", defaultBranch: "main" },
      },
    });
    await expect(context.collaborationStore.getProjectConfig("project-a")).resolves.toMatchObject({
      mode: "github_team",
      repository: { name: "project-memory" },
    });
  });

  it("publishes an automatically accepted memory as a non-retrievable GitHub proposal", async () => {
    const { handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await handlers.configureGitHubTeamMode({
      repository: { host: "github.example.test", owner: "team", name: "project-memory" },
    });

    const result = await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules.",
    });

    expect(result.savedCount).toBe(0);
    expect(result.proposalCount).toBe(1);
    await expect(handlers.searchMemory({ query: "Angular standalone" })).resolves.toEqual([]);
    await expect(handlers.getCollaborationStatus({})).resolves.toMatchObject({
      mode: "github_team",
      proposals: { proposed: 1, active: 0 },
    });
  });

  it("publishes an automatically accepted GitHub proposal when its memory_saved audit write fails", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    rejectMemorySavedAuditWrites(context);

    const result = await handlers.remember({
      content: "Use standalone route components.",
      type: "coding_rule",
      confidence: "high",
    });

    expect(result).toMatchObject({ proposalCount: 1, proposals: [expect.objectContaining({ state: "proposed" })] });
    await expect(context.collaborationStore.listProposals("project-a")).resolves.toEqual([
      expect.objectContaining({ state: "proposed" }),
    ]);
  });

  it("audits GitHub proposal staging instead of presenting it as a shared supersession", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);

    await handlers.remember({ content: "Use standalone route components.", type: "coding_rule", confidence: "high" });

    await expect(context.auditLogStore.list("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "memory_proposed", details: { mode: "github_team", staging: "proposal" } }),
    ]));
  });

  it("audits manually approved GitHub proposal staging", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    await context.pendingCandidateStore.save(candidate({ id: "cand_manual", projectId: "project-a", content: "Use standalone route components." }));

    await handlers.approveMemoryCandidate({ candidateId: "cand_manual" });

    await expect(context.auditLogStore.list("project-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "memory_proposed", entityId: "mem_manual", details: { mode: "github_team", staging: "proposal" } }),
    ]));
  });

  it("publishes a manually approved candidate as a non-retrievable GitHub proposal", async () => {
    const { handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await handlers.configureGitHubTeamMode({
      repository: { host: "github.example.test", owner: "team", name: "project-memory" },
    });
    await handlers.proposeMemoryFromSession({
      summary: "architecture: Runtime environment config is preferred over compile-time environment replacement.",
    });
    const pending = await handlers.listMemoryCandidates({});

    const result = await handlers.approveMemoryCandidate({ candidateId: pending[0]?.id ?? "" });

    expect(result).toMatchObject({ kind: "published", proposal: { state: "proposed" } });
    await expect(handlers.listMemoryCandidates({})).resolves.toEqual([]);
    await expect(handlers.searchMemory({ query: "Runtime environment config" })).resolves.toEqual([]);
  });

  it("publishes a manually approved GitHub proposal when its memory_saved audit write fails", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    await context.pendingCandidateStore.save(candidate({
      id: "cand_manual_audit_failure",
      projectId: "project-a",
      content: "Use standalone route components.",
    }));
    rejectMemorySavedAuditWrites(context);

    const result = await handlers.approveMemoryCandidate({ candidateId: "cand_manual_audit_failure" });

    expect(result).toMatchObject({ kind: "published", proposal: { state: "proposed" } });
    await expect(context.collaborationStore.getProposal("project-a", "mem_manual_audit_failure")).resolves.toMatchObject({
      state: "proposed",
    });
  });

  it("starts eligible retry publication only after safeJsonResult constructs the retrieval response", async () => {
    const runner = new GitHubModeRunner();
    const { context, handlers } = await createHandlers({ githubRunner: runner });
    await handlers.configureGitHubTeamMode({
      repository: { host: "github.example.test", owner: "team", name: "project-memory" },
    });
    await context.collaborationStore.saveProposal({
      projectId: "project-a",
      memory: {
        id: "mem_retry",
        projectId: "project-a",
        type: "coding_rule",
        content: "A failed proposal remains non-retrievable.",
        scope: "unknown",
        confidence: "high",
        sensitivity: "internal",
        reason: "Test retry timing.",
        tags: [],
        status: "active",
        createdAt: "2026-09-12T12:00:00.000Z",
        updatedAt: "2026-09-12T12:00:00.000Z",
      },
      state: "sync_failed",
      retry: { status: "scheduled", attempts: 1, nextAttemptAt: "2000-01-01T00:00:00.000Z" },
      createdAt: "2026-09-12T12:00:00.000Z",
      updatedAt: "2026-09-12T12:00:00.000Z",
    });

    const result = await safeJsonResult(context, "search_memory", {}, async () => ({
      toJSON: () => {
        runner.responseConstructed = true;
        return { memories: [] };
      },
    }));

    expect(result.content[0]?.type === "text" ? JSON.parse(result.content[0].text) : undefined).toEqual({ memories: [] });
    await waitFor(async () => (await context.collaborationStore.getProposal("project-a", "mem_retry"))?.state === "proposed");
    expect(runner.observedPublicationResponseStates).toEqual([true]);
    await expect(context.collaborationStore.getProposal("project-a", "mem_retry")).resolves.toMatchObject({ state: "proposed" });
  });

  it("removes a duplicate approved candidate without publishing or superseding the active GitHub memory", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    const existing = entry({ id: "mem_existing", content: "Use pnpm for package management.", source: { kind: "import", tool: "github" } });
    await context.memoryStore.save(existing);
    await context.pendingCandidateStore.save(candidate({
      id: "cand_duplicate",
      content: existing.content,
      recommendedAction: "ask_user",
    }));

    const result = await handlers.approveMemoryCandidate({ candidateId: "cand_duplicate" });

    expect(result).toMatchObject({ id: "mem_existing", status: "active" });
    await expect(context.pendingCandidateStore.list("project-a")).resolves.toEqual([]);
    await expect(context.memoryStore.findById("project-a", "mem_existing")).resolves.toMatchObject({ status: "active" });
    await expect(handlers.getCollaborationStatus({})).resolves.toMatchObject({ proposals: { proposed: 0 } });
  });

  it("batch duplicate approval preserves active GitHub memories and creates no proposals", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    const existing = entry({ id: "mem_existing", content: "Use pnpm for package management.", source: { kind: "import", tool: "github" } });
    await context.memoryStore.save(existing);
    await context.pendingCandidateStore.save(candidate({ id: "cand_duplicate", content: existing.content, recommendedAction: "ask_user" }));

    const result = await handlers.approveAllCandidates({});

    expect(result.approved).toHaveLength(1);
    await expect(context.pendingCandidateStore.list("project-a")).resolves.toEqual([]);
    await expect(context.memoryStore.findById("project-a", "mem_existing")).resolves.toMatchObject({ status: "active" });
    await expect(handlers.getCollaborationStatus({})).resolves.toMatchObject({ proposals: { proposed: 0 } });
  });

  it("keeps an active GitHub memory retrievable while an automatic conflicting replacement is proposed", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    await context.memoryStore.save(entry({
      id: "mem_pnpm",
      content: "Use pnpm for package management.",
      source: { kind: "import", tool: "github" },
    }));

    const result = await handlers.remember({
      content: "Use yarn for package management.",
      type: "coding_rule",
      confidence: "high",
      scope: "frontend",
    });

    expect(result).toMatchObject({ savedCount: 0, proposalCount: 1 });
    await expect(context.memoryStore.findById("project-a", "mem_pnpm")).resolves.toMatchObject({ status: "active" });
    await expect(handlers.searchMemory({ query: "pnpm package management" })).resolves.toMatchObject([
      expect.objectContaining({ id: "mem_pnpm" }),
    ]);
    await expect(context.collaborationStore.getProposal("project-a", result.proposals?.[0]?.memoryId ?? "")).resolves.toMatchObject({
      removalMemoryIds: ["mem_pnpm"],
    });
  });

  it("retains an automatic GitHub proposal when proposal-stage audit persistence fails", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    const append = context.auditLogStore.append.bind(context.auditLogStore);
    context.auditLogStore.append = async (event) => {
      if (event.type === "memory_proposed") throw new Error("simulated audit failure");
      await append(event);
    };

    await expect(handlers.remember({ content: "Use standalone route components.", type: "coding_rule", confidence: "high" }))
      .resolves.toMatchObject({ proposalCount: 1 });
    await expect(context.collaborationStore.listProposals("project-a")).resolves.toEqual([
      expect.objectContaining({ memory: expect.objectContaining({ id: expect.any(String) }) }),
    ]);
  });

  it("retains a manually approved GitHub proposal when proposal-stage audit persistence fails", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    await context.pendingCandidateStore.save(candidate({ id: "cand_audit_failure", projectId: "project-a", content: "Use standalone route components." }));
    const append = context.auditLogStore.append.bind(context.auditLogStore);
    context.auditLogStore.append = async (event) => {
      if (event.type === "memory_proposed") throw new Error("simulated audit failure");
      await append(event);
    };

    await expect(handlers.approveMemoryCandidate({ candidateId: "cand_audit_failure" }))
      .resolves.toMatchObject({ kind: "published", proposal: { memory: { id: "mem_audit_failure" } } });
    await expect(context.collaborationStore.getProposal("project-a", "mem_audit_failure")).resolves.toMatchObject({ state: "proposed" });
  });

  it("refreshes GitHub memories before exporting static files", async () => {
    const remoteMemory = {
      id: "mem_fresh",
      projectId: "project-a",
      type: "coding_rule",
      content: "Use fresh imported rules.",
      scope: "unknown",
      confidence: "high",
      sensitivity: "internal",
      reason: "Remote snapshot.",
      tags: [],
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { context, handlers, projectRoot } = await createHandlers({ githubRunner: new RefreshingGitHubModeRunner([remoteMemory]) });
    await configureGitHubMode(handlers);
    await context.memoryStore.save(entry({ id: "mem_stale", content: "Use stale local rules.", source: { kind: "import", tool: "github" } }));

    await handlers.exportStaticMemoryFiles({ targets: ["agents"] });

    const exported = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(exported).toContain("Use fresh imported rules.");
    expect(exported).not.toContain("Use stale local rules.");
  });

  it("refreshes GitHub memories before reviewing stale memories", async () => {
    const remoteMemory = {
      id: "mem_fresh_stale",
      projectId: "project-a",
      type: "coding_rule",
      content: "Use fresh stale rules.",
      scope: "unknown",
      confidence: "high",
      sensitivity: "internal",
      reason: "Remote snapshot.",
      tags: [],
      status: "active",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const { context, handlers } = await createHandlers({ githubRunner: new RefreshingGitHubModeRunner([remoteMemory]) });
    await configureGitHubMode(handlers);
    await context.memoryStore.save(entry({
      id: "mem_stale_removed",
      content: "Removed stale local rules.",
      updatedAt: "2020-01-01T00:00:00.000Z",
      source: { kind: "import", tool: "github" },
    }));

    await expect(handlers.reviewStaleMemories({ staleAfterMonths: 1 })).resolves.toMatchObject([
      expect.objectContaining({ id: "mem_fresh_stale" }),
    ]);
  });

  it("keeps an active GitHub memory retrievable while an approved conflicting replacement is proposed", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    await context.memoryStore.save(entry({
      id: "mem_runtime",
      type: "architecture_decision",
      content: "Runtime environment config is preferred over compile-time environment replacement.",
      source: { kind: "import", tool: "github" },
    }));
    await handlers.proposeMemoryFromSession({ summary: "architecture: Compile-time environment config is preferred over runtime environment config." });
    const pending = await handlers.listMemoryCandidates({});

    const result = await handlers.approveMemoryCandidate({ candidateId: pending[0]?.id ?? "" });

    expect(result).toMatchObject({ kind: "published", proposal: { state: "proposed" } });
    await expect(context.memoryStore.findById("project-a", "mem_runtime")).resolves.toMatchObject({ status: "active" });
  });

  it("routes GitHub remember saves into non-retrievable proposals", async () => {
    const { handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);

    const result = await handlers.remember({ content: "Use ESM imports in all TypeScript files.", type: "coding_rule", confidence: "high" });

    expect(result).toMatchObject({ savedCount: 0, proposalCount: 1 });
    await expect(handlers.searchMemory({ query: "ESM imports" })).resolves.toEqual([]);
  });

  it("routes GitHub batch approval into non-retrievable proposals", async () => {
    const { handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    await handlers.proposeMemoryFromSession({ summary: "architecture: Runtime config is preferred over compile-time.\ndeployment: Deploy to staging first." });

    const result = await handlers.approveAllCandidates({});

    expect(result.approved).toHaveLength(2);
    expect(result.approved).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "published", proposal: expect.objectContaining({ state: "proposed" }) }),
    ]));
    await expect(handlers.searchMemory({ query: "runtime config staging" })).resolves.toEqual([]);
  });

  it("returns credential-free collaboration status without subprocess output", async () => {
    const { handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await handlers.configureGitHubTeamMode({
      repository: { host: "github.example.test", owner: "team", name: "project-memory" },
    });

    const status = await handlers.getCollaborationStatus({});
    const serialized = JSON.stringify(status);

    expect(status).toEqual({
      mode: "github_team",
      repository: { host: "github.example.test", owner: "team", name: "project-memory", defaultBranch: "main" },
      proposals: { proposed: 0, active: 0, rejected: 0, syncFailed: 0, conflict: 0 },
      retries: [],
    });
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("remote output");
    expect(serialized).not.toContain("checkoutPath");
  });

  it("keeps Local Private automatic acceptance active and retrievable without GitHub configuration", async () => {
    const { handlers } = await createHandlers();

    const result = await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules.",
    });

    expect(result.savedCount).toBe(1);
    await expect(handlers.searchMemory({ query: "Angular standalone" })).resolves.toHaveLength(1);
    await expect(handlers.getCollaborationStatus({})).resolves.toEqual({
      mode: "local_private",
      proposals: { proposed: 0, active: 0, rejected: 0, syncFailed: 0, conflict: 0 },
      retries: [],
    });
  });

  it("proposes memory from a session and retrieves auto-saved project rules", async () => {
    const { handlers } = await createHandlers();

    const proposed = await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules.",
      tool: "codex"
    });

    expect(proposed.saved).toHaveLength(1);
    expect(proposed.pending).toHaveLength(0);

    const rulesResult = await handlers.getProjectRules({});
    expect(rulesResult.rules).toHaveLength(1);
    expect(rulesResult.rules[0]?.content).toContain("Angular standalone components");
    expect(rulesResult.pendingCandidateCount).toBe(0);

    const contextResult = await handlers.getRelevantContext({ query: "Angular components" });
    expect(contextResult.memories).toHaveLength(1);
    expect(contextResult.memories[0]?.type).toBe("coding_rule");
    expect(contextResult.pendingCandidateCount).toBe(0);
  });

  it("approves pending architecture decisions through the approval handler", async () => {
    const { handlers } = await createHandlers();

    const proposed = await handlers.proposeMemoryFromSession({
      summary: "architecture: Runtime environment config is preferred over compile-time environment replacement."
    });

    expect(proposed.saved).toHaveLength(0);
    expect(proposed.pending).toHaveLength(1);

    const pending = await handlers.listMemoryCandidates({});
    expect(pending).toHaveLength(1);

    const approved = await handlers.approveMemoryCandidate({
      candidateId: pending[0]?.id ?? ""
    });

    expect(approved.type).toBe("architecture_decision");
    await expect(handlers.listMemoryCandidates({})).resolves.toHaveLength(0);

    const rulesResult = await handlers.getProjectRules({});
    expect(rulesResult.rules.map((rule) => rule.id)).toContain(approved.id);
  });

  it("rejects pending candidates through the rejection handler", async () => {
    const { handlers } = await createHandlers();

    await handlers.proposeMemoryFromSession({
      transcript: "deployment: Database schema changes must use Flyway migrations."
    });

    const pending = await handlers.listMemoryCandidates({});
    expect(pending).toHaveLength(1);

    const rejection = await handlers.rejectMemoryCandidate({
      candidateId: pending[0]?.id ?? "",
      reason: "Needs confirmation later."
    });

    expect(rejection.rejected).toBe(true);
    await expect(handlers.listMemoryCandidates({})).resolves.toHaveLength(0);
    await expect(handlers.searchMemory({ query: "Flyway" })).resolves.toHaveLength(0);
  });

  it("exports static fallback memory files", async () => {
    const { handlers, projectRoot } = await createHandlers();

    await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules."
    });

    const exported = await handlers.exportStaticMemoryFiles({
      targets: ["agents", "project_memory"]
    });

    expect(exported.files.map((file) => file.path)).toEqual(["AGENTS.md", "docs/ai/project-memory.md"]);

    const agents = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    const projectMemory = await readFile(join(projectRoot, "docs", "ai", "project-memory.md"), "utf8");
    expect(agents).toContain("Angular standalone components");
    expect(projectMemory).toContain("Angular standalone components");
  });

  it("logs safe diagnostics for user-facing MCP tool errors", async () => {
    const { context, handlers } = await createHandlers();

    const result = await safeJsonResult(context, "propose_memory_from_session", {}, () =>
      handlers.proposeMemoryFromSession({})
    );

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as {
      error: { code: string; message: string; diagnosticId: string };
    };

    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.message).toBe("Either a session transcript or summary is required.");
    expect(payload.error.diagnosticId).toMatch(/^diag_/);

    const diagnostics = await handlers.getDiagnostics({});
    const errorDiag = diagnostics.find((d) => d.id === payload.error.diagnosticId);
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.operation).toBe("propose_memory_from_session");
  });

  it("exposes audit events for memory pipeline activity", async () => {
    const { handlers } = await createHandlers();

    await handlers.proposeMemoryFromSession({
      transcript: "rule: Frontend tests require runtime config to be mocked."
    });

    const auditLog = await handlers.listAuditLog({});
    expect(auditLog.map((event) => event.type)).toContain("session_ingested");
    expect(auditLog.map((event) => event.type)).toContain("memory_saved");
  });

  it("updates a saved memory through the update handler", async () => {
    const { handlers } = await createHandlers();

    const proposed = await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules."
    });
    const savedMemory = proposed.saved[0]!;

    const updated = await handlers.updateMemory({
      memoryId: savedMemory.id,
      content: "This project uses Angular standalone components exclusively.",
      tags: ["angular", "frontend"]
    });

    expect(updated.content).toBe("This project uses Angular standalone components exclusively.");
    expect(updated.tags).toEqual(["angular", "frontend"]);
    expect(updated.id).toBe(savedMemory.id);

    const found = await handlers.searchMemory({ query: "Angular standalone" });
    expect(found).toHaveLength(1);
    expect(found[0]!.content).toBe("This project uses Angular standalone components exclusively.");

    const auditLog = await handlers.listAuditLog({});
    expect(auditLog.map((event) => event.type)).toContain("memory_updated");
  });

  it("routes GitHub memory updates through a proposal without changing the active imported memory", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    await context.memoryStore.save(entry({
      id: "mem_active",
      content: "Use pnpm for package management.",
      source: { kind: "import", tool: "github" },
    }));

    const updated = await handlers.updateMemory({ memoryId: "mem_active", content: "Use yarn for package management." });

    expect(updated).toMatchObject({ kind: "published", proposal: { memory: { id: "mem_active", content: "Use yarn for package management." } } });
    await expect(context.memoryStore.findById("project-a", "mem_active")).resolves.toMatchObject({ content: "Use pnpm for package management.", status: "active" });
  });

  it("routes GitHub memory supersession through a proposal without changing the active imported memory", async () => {
    const { context, handlers } = await createHandlers({ githubRunner: new GitHubModeRunner() });
    await configureGitHubMode(handlers);
    await context.memoryStore.save(entry({
      id: "mem_active",
      content: "Use pnpm for package management.",
      source: { kind: "import", tool: "github" },
    }));

    const superseded = await handlers.supersedeMemory({ memoryId: "mem_active", replacementId: "mem_replacement" });

    expect(superseded).toMatchObject({ kind: "published", proposal: { operation: "remove", memory: { id: "mem_active", status: "active" } } });
    await expect(context.memoryStore.findById("project-a", "mem_active")).resolves.toMatchObject({ status: "active" });
  });

  it("creates a new proposal after GitHub reports a locally proposed update PR has merged", async () => {
    const runner = new MergedProposalRunner();
    const { context, handlers } = await createHandlers({ githubRunner: runner });
    await configureGitHubMode(handlers);
    await saveStaleMergedProposal(context, "mem_active");

    const updated = await handlers.updateMemory({ memoryId: "mem_active", content: "Use yarn for package management." });

    expect(updated).toMatchObject({ kind: "published", proposal: { review: { branch: expect.stringMatching(/^openmembrane\/memory\/mem_active\/2026-/) } } });
    expect(runner.commands.map((command) => command.args.slice(0, 2))).toContainEqual(["pr", "view"]);
    expect(runner.commands.map((command) => command.args.slice(0, 2))).not.toContainEqual(["pr", "edit"]);
  });

  it("creates a new proposal after GitHub reports a locally proposed supersede PR has merged", async () => {
    const runner = new MergedProposalRunner();
    const { context, handlers } = await createHandlers({ githubRunner: runner });
    await configureGitHubMode(handlers);
    await saveStaleMergedProposal(context, "mem_active");

    const superseded = await handlers.supersedeMemory({ memoryId: "mem_active", replacementId: "mem_replacement" });

    expect(superseded).toMatchObject({ kind: "published", proposal: { review: { branch: expect.stringMatching(/^openmembrane\/memory\/mem_active\/2026-/) } } });
    expect(runner.commands.map((command) => command.args.slice(0, 2))).toContainEqual(["pr", "view"]);
    expect(runner.commands.map((command) => command.args.slice(0, 2))).not.toContainEqual(["pr", "edit"]);
  });

  it("returns error when updating memory with secret content", async () => {
    const { context, handlers } = await createHandlers();

    const proposed = await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules."
    });
    const savedMemory = proposed.saved[0]!;

    const result = await safeJsonResult(context, "update_memory", { memoryId: savedMemory.id }, () =>
      handlers.updateMemory({
        memoryId: savedMemory.id,
        content: "Use API key AKIA1234567890ABCDEF for deployments."
      })
    );

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as {
      error: { code: string; diagnosticId: string };
    };
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.diagnosticId).toMatch(/^diag_/);
  });

  it("relocates storage when type changes via update", async () => {
    const { handlers } = await createHandlers();

    const proposed = await handlers.proposeMemoryFromSession({
      transcript: "rule: This project uses Angular standalone components. Do not introduce NgModules."
    });
    const savedMemory = proposed.saved[0]!;
    expect(savedMemory.type).toBe("coding_rule");

    await handlers.updateMemory({
      memoryId: savedMemory.id,
      type: "known_gotcha"
    });

    // Should find exactly one result, not a duplicate at the old path
    const allRules = await handlers.searchMemory({ query: "Angular" });
    expect(allRules).toHaveLength(1);
    expect(allRules[0]!.type).toBe("known_gotcha");
    expect(allRules[0]!.id).toBe(savedMemory.id);
  });

  it("getRelevantContext ranks coding rules above session summaries", async () => {
    const { context, handlers } = await createHandlers();

    // Save two memories with similar content but different types directly
    const { JsonMemoryStore } = await import("@openmembrane/storage");
    const store = context.memoryStore;

    const { entry: entryFactory } = await import("./unit/helpers");
    await store.save(entryFactory({
      id: "mem_summary",
      type: "session_summary",
      content: "We discussed React hooks for state management.",
      confidence: "medium",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));
    await store.save(entryFactory({
      id: "mem_rule",
      type: "coding_rule",
      content: "Always use React hooks for state management.",
      confidence: "high",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));

    const result = await handlers.getRelevantContext({ query: "React hooks state" });

    expect(result.memories).toHaveLength(2);
    expect(result.memories[0]!.id).toBe("mem_rule");
    expect(result.memories[1]!.id).toBe("mem_summary");
  });

  it("searchMemory ranks by text relevance over type", async () => {
    const { context, handlers } = await createHandlers();

    const store = context.memoryStore;
    const { entry: entryFactory } = await import("./unit/helpers");

    await store.save(entryFactory({
      id: "mem_rule",
      type: "coding_rule",
      content: "React components should follow the container pattern.",
      confidence: "high",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));
    await store.save(entryFactory({
      id: "mem_fact",
      type: "project_fact",
      content: "React hooks manage component state and side effects in this project.",
      confidence: "high",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));

    const results = await handlers.searchMemory({ query: "React hooks state" });

    // Both match "react", but mem_fact matches all three tokens while mem_rule only matches one
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("mem_fact");
  });

  it("getRelevantContext respects limit after ranking", async () => {
    const { context, handlers } = await createHandlers();

    const store = context.memoryStore;
    const { entry: entryFactory } = await import("./unit/helpers");

    for (let i = 0; i < 5; i++) {
      await store.save(entryFactory({
        id: `mem_${i}`,
        content: `React pattern number ${i} for components.`,
        updatedAt: `2026-05-0${i + 1}T00:00:00.000Z`
      }));
    }

    const result = await handlers.getRelevantContext({ query: "React", limit: 2 });
    expect(result.memories).toHaveLength(2);
  });

  it("getRelevantContext includes conflict annotations for contradictory memories", async () => {
    const { context, handlers } = await createHandlers();

    const store = context.memoryStore;
    const { entry: entryFactory } = await import("./unit/helpers");

    await store.save(entryFactory({
      id: "mem_pnpm",
      content: "Use pnpm for package management.",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));
    await store.save(entryFactory({
      id: "mem_yarn",
      content: "Use yarn for package management.",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));

    const result = await handlers.getRelevantContext({ query: "package management" });

    expect(result.memories).toHaveLength(2);

    // Both results should have conflict annotations
    const pnpmResult = result.memories.find((r) => r.id === "mem_pnpm")!;
    const yarnResult = result.memories.find((r) => r.id === "mem_yarn")!;
    expect(pnpmResult).toBeDefined();
    expect(yarnResult).toBeDefined();

    const pnpmConflicts = "conflicts" in pnpmResult ? pnpmResult.conflicts : undefined;
    const yarnConflicts = "conflicts" in yarnResult ? yarnResult.conflicts : undefined;

    expect(pnpmConflicts).toBeDefined();
    expect(yarnConflicts).toBeDefined();

    expect(pnpmConflicts).toHaveLength(1);
    expect(pnpmConflicts![0]!.memoryId).toBe("mem_yarn");
    expect(pnpmConflicts![0]!.kind).toBe("alternative");

    expect(yarnConflicts).toHaveLength(1);
    expect(yarnConflicts![0]!.memoryId).toBe("mem_pnpm");
    expect(yarnConflicts![0]!.kind).toBe("alternative");
  });

  it("getRelevantContext omits conflicts field when no conflicts exist", async () => {
    const { context, handlers } = await createHandlers();

    const store = context.memoryStore;
    const { entry: entryFactory } = await import("./unit/helpers");

    await store.save(entryFactory({
      id: "mem_react",
      content: "Use React for frontend components.",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));
    await store.save(entryFactory({
      id: "mem_tests",
      content: "Frontend tests require mocked runtime config.",
      updatedAt: "2026-05-08T00:00:00.000Z"
    }));

    const contextResult = await handlers.getRelevantContext({ query: "frontend" });

    expect(contextResult.memories).toHaveLength(2);

    // Neither result should have conflicts
    for (const mem of contextResult.memories) {
      expect("conflicts" in mem).toBe(false);
    }
  });

  it("surfaces pending candidate count in getProjectRules response", async () => {
    const { handlers } = await createHandlers();
    await handlers.proposeMemoryFromSession({
      summary: "architecture: Runtime config is preferred over compile-time."
    });
    const result = await handlers.getProjectRules({});
    expect(result.pendingCandidateCount).toBe(1);
  });

  it("surfaces pending candidate count in getRelevantContext response", async () => {
    const { handlers } = await createHandlers();
    await handlers.proposeMemoryFromSession({
      summary: "architecture: Runtime config is preferred over compile-time."
    });
    const result = await handlers.getRelevantContext({ query: "config" });
    expect(result.pendingCandidateCount).toBe(1);
  });

  it("batch approves all pending candidates", async () => {
    const { handlers } = await createHandlers();
    await handlers.proposeMemoryFromSession({
      summary: "architecture: Use runtime config.\ndeployment: Deploy to staging first."
    });
    const pending = await handlers.listMemoryCandidates({});
    expect(pending.length).toBeGreaterThanOrEqual(1);

    const result = await handlers.approveAllCandidates({});
    expect(result.approved.length).toBe(pending.length);
    expect(result.skipped).toHaveLength(0);

    const remaining = await handlers.listMemoryCandidates({});
    expect(remaining).toHaveLength(0);
  });

  it("batch rejects all pending candidates", async () => {
    const { handlers } = await createHandlers();
    await handlers.proposeMemoryFromSession({
      summary: "architecture: Use runtime config."
    });
    expect((await handlers.listMemoryCandidates({})).length).toBeGreaterThanOrEqual(1);

    const result = await handlers.rejectAllCandidates({ reason: "Batch cleanup" });
    expect(result.rejectedCount).toBeGreaterThanOrEqual(1);

    const remaining = await handlers.listMemoryCandidates({});
    expect(remaining).toHaveLength(0);
  });

  // --- remember handler tests ---

  it("remember: single save stores a memory", async () => {
    const { handlers } = await createHandlers();
    const result = await handlers.remember({
      content: "Always use ESM imports in this project.",
      type: "coding_rule",
      confidence: "high"
    });
    expect(result.savedCount).toBe(1);
    const search = await handlers.searchMemory({ query: "ESM imports" });
    expect(search.length).toBeGreaterThanOrEqual(1);
  });

  it("remember: batch save stores multiple memories", async () => {
    const { handlers } = await createHandlers();
    const result = await handlers.remember({
      items: [
        { content: "Always run tests before committing code.", type: "coding_rule", confidence: "high" },
        { content: "Node 16 fails silently on ESM imports in CI.", type: "testing_rule", confidence: "high" }
      ]
    });
    expect(result.savedCount).toBe(2);
  });

  it("remember: validation error when missing content+type and no items", async () => {
    const { context, handlers } = await createHandlers();
    const result = await safeJsonResult(context, "remember", {}, () =>
      handlers.remember({} as any)
    );
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as {
      error: { code: string };
    };
    expect(payload.error.code).toBe("VALIDATION_ERROR");
  });

  it("remember: redacts secrets from content before saving", async () => {
    const { handlers } = await createHandlers();
    const result = await handlers.remember({
      content: "Use key sk-proj-abcdefghijklmnop1234567890abcdef for authentication.",
      type: "coding_rule",
      confidence: "high"
    });
    expect(result.redactionCount).toBeGreaterThanOrEqual(1);
    if (result.saved.length > 0) {
      expect(result.saved[0]!.content).not.toContain("sk-proj-");
    }
  });

  it("remember: deduplicates identical content", async () => {
    const { handlers } = await createHandlers();
    const first = await handlers.remember({
      content: "Never use var declarations in TypeScript files.",
      type: "coding_rule",
      confidence: "high"
    });
    expect(first.savedCount).toBe(1);

    const second = await handlers.remember({
      content: "Never use var declarations in TypeScript files.",
      type: "coding_rule",
      confidence: "high"
    });
    expect(second.savedCount).toBe(0);
    expect(second.rejectedCount).toBe(1);
  });

  it("remember: defaults scope to unknown", async () => {
    const { handlers } = await createHandlers();
    await handlers.remember({
      content: "Use descriptive variable names throughout codebase.",
      type: "coding_rule",
      confidence: "high"
    });
    const search = await handlers.searchMemory({ query: "descriptive variable names" });
    expect(search.length).toBeGreaterThanOrEqual(1);
    expect(search[0]!.scope).toBe("unknown");
  });
});

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the expected asynchronous result.");
}

describe("Session nudge reminders (integration)", () => {
  function parseJsonContent(result: Awaited<ReturnType<typeof safeJsonResult>>): unknown {
    const textBlock = result.content[0];
    if (textBlock?.type === "text") {
      return JSON.parse(textBlock.text);
    }
    throw new Error("No text content in result");
  }

  it("injects escalating sessionReminder into object tool responses", async () => {
    const { context, handlers } = await createHandlers();
    const tracker = new SessionNudgeTracker({
      enabled: true,
      threshold: 3,
      escalation: 3,
      reNudgeAfter: 5
    });

    // Call 1: Level 0 (session start prompt)
    const call1 = await safeJsonResult(
      context, "get_project_rules", {},
      () => handlers.getProjectRules({}),
      tracker
    );
    const payload1 = parseJsonContent(call1) as { sessionReminder?: string };
    expect(payload1.sessionReminder).toContain("durable knowledge from previous work");

    // Call 2: no reminder
    const call2 = await safeJsonResult(
      context, "get_relevant_context", { query: "test" },
      () => handlers.getRelevantContext({ query: "test" }),
      tracker
    );
    const payload2 = parseJsonContent(call2) as { sessionReminder?: string };
    expect(payload2.sessionReminder).toBeUndefined();

    // Call 3: Level 1 (gentle)
    const call3 = await safeJsonResult(
      context, "get_project_rules", {},
      () => handlers.getProjectRules({}),
      tracker
    );
    const payload3 = parseJsonContent(call3) as { sessionReminder?: string };
    expect(payload3.sessionReminder).toContain("No memories saved this session");

    // Calls 4-5: still Level 1
    await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);
    await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);

    // Call 6: Level 2 (direct)
    const call6 = await safeJsonResult(
      context, "get_project_rules", {},
      () => handlers.getProjectRules({}),
      tracker
    );
    const payload6 = parseJsonContent(call6) as { sessionReminder?: string };
    expect(payload6.sessionReminder).toContain("You have made 6 tool calls");

    // Calls 7-8: still Level 2
    await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);
    await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);

    // Call 9: Level 3 (urgent)
    const call9 = await safeJsonResult(
      context, "get_project_rules", {},
      () => handlers.getProjectRules({}),
      tracker
    );
    const payload9 = parseJsonContent(call9) as { sessionReminder?: string };
    expect(payload9.sessionReminder).toContain("IMPORTANT");
    expect(payload9.sessionReminder).toContain("9 interactions");
  });

  it("reminders disappear after a successful remember call", async () => {
    const { context, handlers } = await createHandlers();
    const tracker = new SessionNudgeTracker({
      enabled: true,
      threshold: 3,
      escalation: 3,
      reNudgeAfter: 5
    });

    // Make 3 calls to trigger Level 1
    for (let i = 0; i < 3; i++) {
      await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);
    }

    // Call remember (call 4) — this is a save operation
    const rememberResult = await safeJsonResult(
      context, "remember", {},
      () => handlers.remember({
        content: "Always use ESM imports.",
        type: "coding_rule",
        confidence: "high"
      }),
      tracker
    );
    // The remember call itself still gets a reminder (Level 1 at call 4)
    expect(rememberResult.isError).toBeUndefined();

    // Call 5: after save, no reminder
    const afterSave = await safeJsonResult(
      context, "get_project_rules", {},
      () => handlers.getProjectRules({}),
      tracker
    );
    const afterPayload = parseJsonContent(afterSave) as { sessionReminder?: string };
    expect(afterPayload.sessionReminder).toBeUndefined();
  });

  it("re-nudges after reNudgeAfter more calls without another save", async () => {
    const { context, handlers } = await createHandlers();
    const tracker = new SessionNudgeTracker({
      enabled: true,
      threshold: 3,
      escalation: 3,
      reNudgeAfter: 5
    });

    // Call 1 (Level 0) then save
    await safeJsonResult(context, "remember", {}, () => handlers.remember({
      content: "Use strict mode.",
      type: "coding_rule",
      confidence: "high"
    }), tracker);
    // tracker.recordMemorySaved() is called automatically for save ops

    // Calls 2-5: no reminder (callsSinceLastSave < 5)
    for (let i = 0; i < 4; i++) {
      const result = await safeJsonResult(
        context, "get_project_rules", {},
        () => handlers.getProjectRules({}),
        tracker
      );
      const payload = parseJsonContent(result) as { sessionReminder?: string };
      expect(payload.sessionReminder).toBeUndefined();
    }

    // Call 6: re-nudge (callsSinceLastSave = 5)
    const reNudge = await safeJsonResult(
      context, "get_project_rules", {},
      () => handlers.getProjectRules({}),
      tracker
    );
    const reNudgePayload = parseJsonContent(reNudge) as { sessionReminder?: string };
    expect(reNudgePayload.sessionReminder).toContain("No memories saved this session");
  });

  it("does not inject sessionReminder when nudging is disabled", async () => {
    const { context, handlers } = await createHandlers();
    const tracker = new SessionNudgeTracker({
      enabled: false,
      threshold: 3,
      escalation: 3,
      reNudgeAfter: 5
    });

    // Make many calls — no reminder should ever appear
    for (let i = 0; i < 12; i++) {
      const result = await safeJsonResult(
        context, "get_project_rules", {},
        () => handlers.getProjectRules({}),
        tracker
      );
      const payload = parseJsonContent(result) as { sessionReminder?: string };
      expect(payload.sessionReminder).toBeUndefined();
    }
  });

  it("adds reminder as second content block for array responses", async () => {
    const { context, handlers } = await createHandlers();
    const tracker = new SessionNudgeTracker({
      enabled: true,
      threshold: 2,
      escalation: 3,
      reNudgeAfter: 5
    });

    // Call 1: Level 0
    await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);

    // Call 2: Level 1 — searchMemory returns an array
    const result = await safeJsonResult(
      context, "search_memory", { query: "test" },
      () => handlers.searchMemory({ query: "test" }),
      tracker
    );

    // First content block is the array data
    expect(result.content[0]?.type).toBe("text");
    const data = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
    expect(Array.isArray(data)).toBe(true);

    // Second content block is the reminder
    expect(result.content.length).toBe(2);
    expect(result.content[1]?.type).toBe("text");
    expect((result.content[1] as { type: "text"; text: string }).text).toContain("No memories saved this session");
  });

  it("propose_memory_from_session is treated as a save operation", async () => {
    const { context, handlers } = await createHandlers();
    const tracker = new SessionNudgeTracker({
      enabled: true,
      threshold: 3,
      escalation: 3,
      reNudgeAfter: 5
    });

    // Make 3 calls to trigger Level 1
    for (let i = 0; i < 3; i++) {
      await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);
    }

    // Call propose_memory_from_session (save operation)
    await safeJsonResult(
      context, "propose_memory_from_session", {},
      () => handlers.proposeMemoryFromSession({
        transcript: "rule: This project uses strict TypeScript mode. Do not disable it."
      }),
      tracker
    );

    // Next call should have no reminder
    const afterSave = await safeJsonResult(
      context, "get_project_rules", {},
      () => handlers.getProjectRules({}),
      tracker
    );
    const payload = parseJsonContent(afterSave) as { sessionReminder?: string };
    expect(payload.sessionReminder).toBeUndefined();
  });

  it("does not suppress reminders when remember saves zero memories (e.g., duplicates)", async () => {
    const { context, handlers } = await createHandlers();
    const tracker = new SessionNudgeTracker({
      enabled: true,
      threshold: 3,
      escalation: 3,
      reNudgeAfter: 5
    });

    // Save a memory first time
    await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);
    await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);
    await safeJsonResult(context, "remember", {}, () => handlers.remember({
      content: "Never use var declarations in TypeScript files.",
      type: "coding_rule",
      confidence: "high"
    }), tracker);

    // At this point, memory is saved → reminders suppressed.
    // Now make enough calls to re-nudge
    for (let i = 0; i < 5; i++) {
      await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);
    }

    // Call 9: should be re-nudging now
    const nudge = await safeJsonResult(context, "get_project_rules", {}, () => handlers.getProjectRules({}), tracker);
    const nudgePayload = parseJsonContent(nudge) as { sessionReminder?: string };
    expect(nudgePayload.sessionReminder).toContain("No memories saved");

    // Try to save the SAME content again (will be deduplicated, savedCount = 0)
    await safeJsonResult(context, "remember", {}, () => handlers.remember({
      content: "Never use var declarations in TypeScript files.",
      type: "coding_rule",
      confidence: "high"
    }), tracker);

    // Reminders should NOT be suppressed because nothing was actually saved
    const afterDuplicate = await safeJsonResult(
      context, "get_project_rules", {},
      () => handlers.getProjectRules({}),
      tracker
    );
    const afterPayload = parseJsonContent(afterDuplicate) as { sessionReminder?: string };
    expect(afterPayload.sessionReminder).toContain("No memories saved");
  });
});
