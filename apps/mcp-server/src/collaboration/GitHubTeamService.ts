import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  CollaborationProjectConfig,
  CollaborationProposal,
  CollaborationStore,
  DiagnosticsLogStore,
  MemoryEntry,
  MemoryStore,
  SharedMemoryEntry,
} from "@openmembrane/core";
import { createId, nowIso } from "@openmembrane/shared";
import {
  createManifestFile,
  createMemoryFile,
  createProjectFile,
  sharedMemoryContentHash,
  validateManifestFile,
  validateMemoryFiles,
  validateProjectFile,
} from "./GitHubRepository";
import { GitHubCli, type CommandResult, type GitHubPullRequestView, type GitHubRepositoryView } from "./GitHubCli";

export interface ConfigureGitHubTeamInput {
  projectId: string;
  repository: {
    host: string;
    owner: string;
    name: string;
  };
}

export type ConfigureGitHubTeamResult =
  | { kind: "configured"; config: CollaborationProjectConfig }
  | { kind: "rejected"; code: GitHubTeamConfigurationErrorCode; message: string };

export type GitHubTeamConfigurationErrorCode =
  | "GITHUB_CONFIGURATION_INVALID"
  | "GITHUB_CLI_UNAVAILABLE"
  | "GITHUB_AUTH_REQUIRED"
  | "GITHUB_REPOSITORY_UNAVAILABLE"
  | "GITHUB_REPOSITORY_NOT_PRIVATE"
  | "GITHUB_REPOSITORY_NOT_INITIALIZED"
  | "GITHUB_CHECKOUT_FAILED";

export type PublishAcceptedMemoryResult =
  | { kind: "published"; proposal: CollaborationProposal }
  | { kind: "retry_scheduled"; code: "GITHUB_PUBLICATION_FAILED"; nextAttemptAt: string }
  | { kind: "retry_deferred"; nextAttemptAt: string }
  | { kind: "rejected"; code: "GITHUB_TEAM_NOT_CONFIGURED" | "GITHUB_MEMORY_INVALID"; message: string };

const retryBaseDelayMs = 60_000;
const retryMaxDelayMs = 3_600_000;

export interface GitHubTeamServiceOptions {
  collaborationStore: CollaborationStore;
  memoryStore: MemoryStore;
  diagnosticsLogStore: DiagnosticsLogStore;
  github: GitHubCli;
  storageDir: string;
  now?: () => string;
}

export class GitHubTeamService {
  private readonly collaborationStore: CollaborationStore;
  private readonly memoryStore: MemoryStore;
  private readonly diagnosticsLogStore: DiagnosticsLogStore;
  private readonly github: GitHubCli;
  private readonly storageDir: string;
  private readonly now: () => string;
  private readonly projectOperations = new Map<string, Promise<void>>();

  constructor(options: GitHubTeamServiceOptions) {
    this.collaborationStore = options.collaborationStore;
    this.memoryStore = options.memoryStore;
    this.diagnosticsLogStore = options.diagnosticsLogStore;
    this.github = options.github;
    this.storageDir = options.storageDir;
    this.now = options.now ?? nowIso;
  }

  async configure(input: ConfigureGitHubTeamInput): Promise<ConfigureGitHubTeamResult> {
    return this.runProjectOperation(input.projectId, () => this.configureProject(input));
  }

  private async configureProject(input: ConfigureGitHubTeamInput): Promise<ConfigureGitHubTeamResult> {
    const validation = validateConfigureInput(input);
    if (validation !== undefined) {
      return this.reject(input.projectId, "GITHUB_CONFIGURATION_INVALID", validation);
    }

    const ghVersion = await this.github.version();
    if (!succeeded(ghVersion)) {
      return this.reject(
        input.projectId,
        "GITHUB_CLI_UNAVAILABLE",
        "GitHub CLI is unavailable. Install GitHub CLI and try again.",
      );
    }

    const authStatus = await this.github.authStatus(input.repository.host);
    if (!succeeded(authStatus)) {
      return this.reject(
        input.projectId,
        "GITHUB_AUTH_REQUIRED",
        "GitHub CLI is not authenticated for the selected host.",
      );
    }

    const repository = repositoryAddress(input.repository);
    const viewResult = await this.github.repositoryView(repository);
    const view = parseRepositoryView(viewResult, `${input.repository.owner}/${input.repository.name}`);
    if (view === undefined) {
      return this.reject(
        input.projectId,
        "GITHUB_REPOSITORY_UNAVAILABLE",
        "The selected GitHub repository is unavailable or cannot be accessed.",
      );
    }
    if (!view.isPrivate) {
      return this.reject(input.projectId, "GITHUB_REPOSITORY_NOT_PRIVATE", "The selected repository must be private.");
    }

    const defaultBranch = view.defaultBranch?.name ?? "main";
    const checkoutPath = collaborationCheckoutPath(this.storageDir, input.projectId);
    await mkdir(resolve(checkoutPath, ".."), { recursive: true });
    const clone = await this.github.clone(repositoryUrl(input.repository), checkoutPath);
    if (!succeeded(clone)) {
      return this.reject(input.projectId, "GITHUB_CHECKOUT_FAILED", "OpenMembrane could not create the repository checkout.");
    }

    const remoteRefs = await this.github.remoteRefs(checkoutPath);
    if (!succeeded(remoteRefs)) {
      return this.reject(input.projectId, "GITHUB_CHECKOUT_FAILED", "OpenMembrane could not inspect the repository checkout.");
    }

    if (remoteRefs.stdout.trim() !== "") {
      const projectFile = await this.github.showRemoteFile(checkoutPath, defaultBranch, ".openmembrane/project.json");
      const projectMetadata = succeeded(projectFile) ? validateProjectFile(projectFile.stdout, input.projectId) : undefined;
      if (projectMetadata?.kind !== "valid" || projectMetadata.value.defaultBranch !== defaultBranch) {
        return this.reject(
          input.projectId,
          "GITHUB_REPOSITORY_NOT_INITIALIZED",
          "The selected repository is not empty or initialized for this OpenMembrane project.",
        );
      }
    }

    const timestamp = this.now();
    const config: CollaborationProjectConfig = {
      projectId: input.projectId,
      mode: "github_team",
      repository: {
        host: input.repository.host,
        owner: input.repository.owner,
        name: input.repository.name,
        defaultBranch,
      },
      checkoutPath,
      repositoryInitialized: remoteRefs.stdout.trim() !== "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.collaborationStore.saveProjectConfig(config);
    return { kind: "configured", config };
  }

  async publishAcceptedMemory(entry: MemoryEntry, removalMemoryIds: string[] = []): Promise<PublishAcceptedMemoryResult> {
    return this.publish(entry.projectId, entry.id, entry, "upsert", removalMemoryIds);
  }

  async updateProposal(memoryId: string, entry: MemoryEntry): Promise<PublishAcceptedMemoryResult> {
    if (entry.id !== memoryId) {
      return { kind: "rejected", code: "GITHUB_MEMORY_INVALID", message: "The memory ID does not match the update request." };
    }
    return this.publish(entry.projectId, memoryId, entry);
  }

  async supersedeMemory(entry: MemoryEntry): Promise<PublishAcceptedMemoryResult> {
    return this.publish(entry.projectId, entry.id, entry, "remove");
  }

  async refreshBeforeRetrieval(projectId: string): Promise<void> {
    await this.runProjectOperation(projectId, () => this.refreshProjectBeforeRetrieval(projectId));
  }

  private async refreshProjectBeforeRetrieval(projectId: string): Promise<void> {
    const config = await this.collaborationStore.getProjectConfig(projectId);
    if (config === undefined || config.mode !== "github_team") return;

    const proposals = await this.collaborationStore.listProposals(projectId);

    const fetched = await this.github.fetchDefaultBranch(config.checkoutPath, config.repository.defaultBranch);
    if (!succeeded(fetched)) return;
    const commitResult = await this.github.defaultBranchCommit(config.checkoutPath, config.repository.defaultBranch);
    const commit = parseCommit(commitResult);
    if (commit === undefined) return;

    const checkpoint = await this.collaborationStore.getCheckpoint(projectId);
    if (checkpoint?.defaultBranchCommit === commit) {
      await this.refreshProposalReviews(config, proposals, new Set(await this.memoryStore.list(projectId).then((memories) => memories.map((memory) => memory.id))));
      return;
    }

    const changed = checkpoint === undefined
      ? undefined
      : parseChangedFiles(await this.github.changedFiles(config.checkoutPath, checkpoint.defaultBranchCommit, commit));
    const snapshot = await this.importDefaultBranch(config, changed?.manifestChanged ? undefined : changed?.memoryPaths);
    if (!snapshot.complete) return;
    await this.refreshProposalReviews(config, proposals, snapshot.importedIds, snapshot.removedIds);
    await this.collaborationStore.saveCheckpoint({ projectId, defaultBranchCommit: commit, syncedAt: this.now() });
  }

  async retryEligiblePublications(projectId: string): Promise<void> {
    await this.runProjectOperation(projectId, () => this.retryProjectPublications(projectId));
  }

  private async retryProjectPublications(projectId: string): Promise<void> {
    const config = await this.collaborationStore.getProjectConfig(projectId);
    if (config === undefined || config.mode !== "github_team") return;

    const now = this.now();
    const proposals = await this.collaborationStore.listProposals(projectId);
    for (const proposal of proposals) {
      if (proposal.state !== "sync_failed" || proposal.retry.nextAttemptAt === undefined || proposal.retry.nextAttemptAt > now) continue;
      await this.publishProjectMemory(
        projectId,
        proposal.memory.id,
        { ...proposal.memory, source: { kind: "manual" } },
        proposal.operation ?? "upsert",
        proposal.removalMemoryIds ?? [],
      );
    }
  }

  private async refreshProposalReviews(
    config: CollaborationProjectConfig,
    proposals: readonly CollaborationProposal[],
    importedIds: ReadonlySet<string>,
    removedIds = new Set<string>(),
  ): Promise<void> {
    for (const proposal of proposals) {
      if (proposal.review === undefined || proposal.state === "active" || proposal.state === "rejected" || proposal.state === "conflict") continue;
      const view = parsePullRequestView(await this.github.inspectPullRequest(repositoryAddress(config.repository), proposal.review.id));
      if (view === undefined) continue;
      const timestamp = this.now();
      if (view.state === "MERGED") {
        const current = await this.collaborationStore.getProposal(config.projectId, proposal.memory.id);
        if (current === undefined || current.state !== "proposed" || current.review === undefined) continue;
        if (current.operation === "remove" ? !removedIds.has(current.memory.id) : !importedIds.has(current.memory.id)) continue;
        await this.collaborationStore.saveProposal({
          ...current,
          state: "active",
          review: {
            ...current.review,
            ...(view.mergedAt === undefined ? {} : { mergedAt: view.mergedAt }),
            ...(view.mergeCommit === undefined ? {} : { mergedCommit: view.mergeCommit }),
          },
          updatedAt: timestamp,
        });
        await this.appendEvent(config.projectId, proposal.memory.id, "review_merged");
      } else if (view.state === "CLOSED") {
        const current = await this.collaborationStore.getProposal(config.projectId, proposal.memory.id);
        if (current === undefined || current.state !== "proposed" || current.review === undefined) continue;
        await this.collaborationStore.saveProposal({
          ...current,
          state: "rejected",
          review: {
            ...current.review,
            ...(view.closedAt === undefined ? {} : { closedAt: view.closedAt }),
            ...(view.closedBy === undefined ? {} : { closedBy: view.closedBy }),
          },
          updatedAt: timestamp,
        });
        await this.appendEvent(config.projectId, proposal.memory.id, "review_closed");
      } else if (view.reviewDecision === "CHANGES_REQUESTED") {
        await this.appendEvent(config.projectId, proposal.memory.id, "review_changes_requested");
      }
    }
  }

  private async importDefaultBranch(
    config: CollaborationProjectConfig,
    changedFiles: Set<string> | undefined,
  ): Promise<SnapshotImportResult> {
    const manifestResult = await this.github.showRemoteFile(config.checkoutPath, config.repository.defaultBranch, ".openmembrane/manifest.json");
    if (!succeeded(manifestResult)) return incompleteSnapshot();
    const manifest = validateManifestFile(manifestResult.stdout, config.projectId);
    if (manifest.kind === "quarantined" || manifest.value.defaultBranch !== config.repository.defaultBranch) {
      await this.appendEvent(config.projectId, undefined, "memory_quarantined");
      return incompleteSnapshot();
    }

    const duplicateIds = duplicateManifestIds(manifest.value.memories.map((memory) => memory.id));
    for (const id of duplicateIds) {
      await this.appendEvent(config.projectId, id, "memory_quarantined");
    }
    const authoritativeIds = new Set(manifest.value.memories.map((memory) => memory.id));
    const filesToRead = changedFiles === undefined
      ? manifest.value.memories.filter((memory) => !duplicateIds.has(memory.id)).map((memory) => `.openmembrane/memories/${memory.id}.json`)
      : [...changedFiles].filter((path) => authoritativeIds.has(memoryIdFromPath(path)) && !duplicateIds.has(memoryIdFromPath(path)));
    const remoteFiles = await Promise.all(filesToRead.map(async (path) => {
      const result = await this.github.showRemoteFile(config.checkoutPath, config.repository.defaultBranch, path);
      return succeeded(result) ? { path, content: result.stdout } : { path, content: "" };
    }));
    const validation = validateMemoryFiles(remoteFiles, config.projectId);
    for (const quarantined of validation.quarantined) {
      await this.appendEvent(config.projectId, memoryIdFromPath(quarantined.path), "memory_quarantined");
    }
    const manifestHashes = new Map(manifest.value.memories.map((memory) => [memory.id, memory.contentHash]));
    const valid: SharedMemoryEntry[] = [];
    for (const memory of validation.valid) {
      if (manifestHashes.get(memory.id) === sharedMemoryContentHash(memory)) {
        valid.push(memory);
      } else {
        await this.appendEvent(config.projectId, memory.id, "memory_quarantined");
      }
    }
    const importedIds = new Set<string>();
    const removedIds = new Set<string>();
    for (const memory of valid) {
      if (await this.importMemory(config.projectId, memory)) importedIds.add(memory.id);
    }

    const complete = duplicateIds.size === 0 && validation.quarantined.length === 0 && valid.length === remoteFiles.length;
    if (complete && changedFiles === undefined) {
      const current = await this.memoryStore.list(config.projectId);
      for (const memory of current) {
        if (memory.source.kind === "import" && memory.source.tool === "github" && !authoritativeIds.has(memory.id)) {
          await this.memoryStore.supersede(config.projectId, memory.id);
          removedIds.add(memory.id);
          await this.appendEvent(config.projectId, memory.id, "memory_removed");
        }
      }
    }
    return { complete, importedIds, removedIds };
  }

  private async importMemory(projectId: string, memory: SharedMemoryEntry): Promise<boolean> {
    const current = await this.memoryStore.findById(projectId, memory.id);
    if (current !== undefined && current.source.kind !== "import" && !sameSharedMemory(current, memory)) {
      const existing = await this.collaborationStore.getProposal(projectId, memory.id);
      if (isSupersededProposalStaging(current, existing, memory)) {
        await this.memoryStore.save({ ...memory, source: { kind: "import", tool: "github" } });
        await this.appendEvent(projectId, memory.id, "memory_imported");
        return true;
      }
      const timestamp = this.now();
      await this.collaborationStore.saveProposal({
        ...(existing ?? {
          projectId,
          memory,
          retry: { status: "not_scheduled" as const, attempts: 0 },
          createdAt: timestamp,
        }),
        state: "conflict",
        updatedAt: timestamp,
      });
      await this.appendEvent(projectId, memory.id, "memory_conflicted");
      return false;
    }
    if (current !== undefined && sameSharedMemory(current, memory)) return true;
    await this.memoryStore.save({ ...memory, source: { kind: "import", tool: "github" } });
    await this.appendEvent(projectId, memory.id, "memory_imported");
    return true;
  }

  private async appendEvent(
    projectId: string,
    memoryId: string | undefined,
    type: import("@openmembrane/core").CollaborationEvent["type"],
  ): Promise<void> {
    await this.collaborationStore.appendEvent({
      id: createId("collab_evt"),
      projectId,
      ...(memoryId === undefined ? {} : { memoryId }),
      type,
      createdAt: this.now(),
    });
  }

  private async publish(
    projectId: string,
    memoryId: string,
    entry: MemoryEntry,
    operation: "upsert" | "remove" = "upsert",
    removalMemoryIds: string[] = [],
  ): Promise<PublishAcceptedMemoryResult> {
    return this.runProjectOperation(projectId, () => this.publishProjectMemory(projectId, memoryId, entry, operation, removalMemoryIds));
  }

  private async publishProjectMemory(
    projectId: string,
    memoryId: string,
    entry: MemoryEntry,
    operation: "upsert" | "remove" = "upsert",
    removalMemoryIds: string[] = [],
  ): Promise<PublishAcceptedMemoryResult> {
    let memory: SharedMemoryEntry;
    try {
      memory = sharedMemory(entry);
      createMemoryFile(memory);
    } catch {
      return { kind: "rejected", code: "GITHUB_MEMORY_INVALID", message: "The accepted memory cannot be published safely." };
    }

    const config = await this.collaborationStore.getProjectConfig(projectId);
    if (config === undefined || config.mode !== "github_team") {
      return { kind: "rejected", code: "GITHUB_TEAM_NOT_CONFIGURED", message: "GitHub Team mode is not configured for this project." };
    }

    const existing = await this.collaborationStore.getProposal(projectId, memoryId);
    const timestamp = this.now();
    if (existing?.state === "sync_failed" && existing.retry.nextAttemptAt !== undefined && timestamp < existing.retry.nextAttemptAt) {
      return { kind: "retry_deferred", nextAttemptAt: existing.retry.nextAttemptAt };
    }

    const reusable = existing?.review !== undefined && (existing.state === "proposed" || existing.state === "sync_failed");
    const reviewView = reusable
      ? parsePullRequestView(await this.github.inspectPullRequest(repositoryAddress(config.repository), existing.review!.id))
      : undefined;
    const prior = reviewView?.state === "OPEN" ? existing : undefined;
    const staleReview = reviewView !== undefined && reviewView.state !== "OPEN";
    const freshLifecycle = staleReview || existing?.state === "active";
    const branch = prior?.review?.branch ?? proposalBranch(memoryId, timestamp, freshLifecycle);
    const discovered = prior?.review === undefined
      ? await this.findExistingPullRequest(config, branch, memoryId)
      : undefined;
    const existingReview = prior?.review ?? discovered;
    const isUpdate = existingReview !== undefined;
    const proposal = this.proposalForAttempt(existing, memory, timestamp, freshLifecycle, operation, removalMemoryIds);
    try {
      const action = isUpdate ? "update" : "propose";
      await this.ensureDefaultBranch(config);
      await this.runPublicationCommand(this.github.fetchDefaultBranch(config.checkoutPath, config.repository.defaultBranch));
      if (existingReview !== undefined) {
        await this.runPublicationCommand(this.github.fetchBranch(config.checkoutPath, branch));
      }
      await this.runPublicationCommand(this.github.checkoutBranch(
        config.checkoutPath,
        branch,
        existingReview === undefined ? `origin/${config.repository.defaultBranch}` : `origin/${branch}`,
      ));
      await this.writeProposalFiles(config, memory, proposal.operation ?? "upsert", proposal.removalMemoryIds ?? []);
      await this.runPublicationCommand(this.github.addOpenMembraneFiles(config.checkoutPath));
      await this.runPublicationCommand(this.github.commit(config.checkoutPath, `memory: ${action} ${memoryId}`));
      await this.runPublicationCommand(this.github.pushBranch(config.checkoutPath, branch));

      const pullRequest = {
        repository: repositoryAddress(config.repository),
        base: config.repository.defaultBranch,
        head: branch,
        title: `memory: ${action} ${memoryId}`,
        body: proposalDescription(memory, proposal.operation === "remove" ? "remove" : action === "propose" ? "create" : "update"),
      };
      let review = existingReview;
      if (review === undefined) {
        const result = await this.github.createPullRequest(pullRequest);
        const url = succeeded(result) ? parsePullRequestUrl(result.stdout) : undefined;
        review = url === undefined ? await this.findExistingPullRequest(config, branch, memoryId) : {
          provider: "github",
          id: pullRequestId(url),
          url,
          branch,
        };
        if (review === undefined) throw new Error("Pull request creation failed.");
      } else {
        await this.runPublicationCommand(this.github.updatePullRequest({ ...pullRequest, number: review.id }));
      }

      const published: CollaborationProposal = {
        ...proposal,
        state: "proposed",
        review,
        retry: { status: "not_scheduled", attempts: 0 },
        updatedAt: timestamp,
      };
      await this.collaborationStore.saveProposal(published);
      await this.appendEvent(projectId, memoryId, prior === undefined ? "proposal_created" : "review_updated");
      if (existingReview === undefined) await this.appendEvent(projectId, memoryId, "review_created");
      return { kind: "published", proposal: published };
    } catch {
      const review = await this.findExistingPullRequest(config, branch, memoryId);
      if (review !== undefined) {
        const recovered: CollaborationProposal = {
          ...proposal,
          state: "proposed",
          review,
          retry: { status: "not_scheduled", attempts: 0 },
          updatedAt: timestamp,
        };
        try {
            await this.collaborationStore.saveProposal(recovered);
            await this.appendEvent(projectId, memoryId, "review_created");
            return { kind: "published", proposal: recovered };
        } catch {
          // Retry state below remains the durable fallback if recovery cannot be persisted.
        }
      }
      const failed = this.failedProposal({
        ...proposal,
        ...(review === undefined ? {} : { review }),
      }, timestamp);
      await this.collaborationStore.saveProposal(failed);
      await this.appendEvent(projectId, memoryId, "retry_scheduled");
      await this.recordPublicationFailure(projectId);
      return {
        kind: "retry_scheduled",
        code: "GITHUB_PUBLICATION_FAILED",
        nextAttemptAt: failed.retry.nextAttemptAt as string,
      };
    }
  }

  private proposalForAttempt(
    existing: CollaborationProposal | undefined,
    memory: SharedMemoryEntry,
    timestamp: string,
    freshAttempt = false,
    operation: "upsert" | "remove" = "upsert",
    removalMemoryIds: string[] = [],
  ): CollaborationProposal {
    const preservedRemovalMemoryIds = removalMemoryIds.length === 0 ? existing?.removalMemoryIds ?? [] : removalMemoryIds;
    return {
      projectId: memory.projectId,
      memory,
      operation,
      ...(preservedRemovalMemoryIds.length === 0 ? {} : { removalMemoryIds: preservedRemovalMemoryIds }),
      state: existing?.state ?? "proposed",
      ...(freshAttempt || existing?.review === undefined ? {} : { review: existing.review }),
      retry: freshAttempt ? { status: "not_scheduled", attempts: 0 } : existing?.retry ?? { status: "not_scheduled", attempts: 0 },
      createdAt: freshAttempt ? timestamp : existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
  }

  private async writeProposalFiles(
    config: CollaborationProjectConfig,
    memory: SharedMemoryEntry,
    operation: "upsert" | "remove",
    removalMemoryIds: readonly string[],
  ): Promise<void> {
    const defaultMemories = await this.defaultBranchMemories(config, memory.id);
    const removedIds = new Set(operation === "remove" ? [memory.id] : removalMemoryIds);
    const manifestFile = createManifestFile({
      projectId: memory.projectId,
      defaultBranch: config.repository.defaultBranch,
      memories: operation === "remove"
        ? defaultMemories.filter((entry) => !removedIds.has(entry.id))
        : [...defaultMemories.filter((entry) => entry.id !== memory.id && !removedIds.has(entry.id)), memory],
      generatedAt: this.now(),
    });
    await mkdir(resolve(config.checkoutPath, ".openmembrane", "memories"), { recursive: true });
    const memoryPath = join(config.checkoutPath, ".openmembrane", "memories", `${memory.id}.json`);
    if (operation !== "remove") {
      const memoryFile = createMemoryFile(memory);
      await writeFile(join(config.checkoutPath, memoryFile.path), memoryFile.content, "utf8");
    }
    for (const id of removedIds) {
      await rm(join(config.checkoutPath, ".openmembrane", "memories", `${id}.json`), { force: true });
    }
    await writeFile(join(config.checkoutPath, manifestFile.path), manifestFile.content, "utf8");
  }

  private async ensureDefaultBranch(config: CollaborationProjectConfig): Promise<void> {
    if (config.repositoryInitialized !== false) return;
    const projectFile = await this.github.showRemoteFile(config.checkoutPath, config.repository.defaultBranch, ".openmembrane/project.json");
    if (succeeded(projectFile)) {
      const validation = validateProjectFile(projectFile.stdout, config.projectId);
      if (validation.kind !== "valid" || validation.value.defaultBranch !== config.repository.defaultBranch) {
        throw new Error("Default branch OpenMembrane metadata is invalid.");
      }
      return;
    }

    await this.runPublicationCommand(this.github.checkoutOrphanBranch(config.checkoutPath, config.repository.defaultBranch));
    const metadata = createProjectFile({ projectId: config.projectId, defaultBranch: config.repository.defaultBranch });
    await mkdir(resolve(config.checkoutPath, ".openmembrane"), { recursive: true });
    await writeFile(join(config.checkoutPath, metadata.path), metadata.content, "utf8");
    await this.runPublicationCommand(this.github.addOpenMembraneFiles(config.checkoutPath));
    await this.runPublicationCommand(this.github.commit(config.checkoutPath, "memory: initialize OpenMembrane"));
    await this.runPublicationCommand(this.github.pushBranch(config.checkoutPath, config.repository.defaultBranch));
    await this.collaborationStore.saveProjectConfig({ ...config, repositoryInitialized: true, updatedAt: this.now() });
  }

  private async defaultBranchMemories(config: CollaborationProjectConfig, proposedMemoryId?: string): Promise<SharedMemoryEntry[]> {
    const manifestResult = await this.github.showRemoteFile(config.checkoutPath, config.repository.defaultBranch, ".openmembrane/manifest.json");
    if (!succeeded(manifestResult)) return [];
    const manifest = validateManifestFile(manifestResult.stdout, config.projectId);
    if (manifest.kind !== "valid" || manifest.value.defaultBranch !== config.repository.defaultBranch) {
      throw new Error("Default branch manifest is invalid.");
    }
    const ids = manifest.value.memories.map((item) => item.id);
    if (duplicateManifestIds(ids).size > 0) throw new Error("Default branch manifest contains duplicate memories.");
    const files = await Promise.all(ids.map(async (id) => {
      const path = `.openmembrane/memories/${id}.json`;
      const result = await this.github.showRemoteFile(config.checkoutPath, config.repository.defaultBranch, path);
      return { id, path, content: succeeded(result) ? result.stdout : "" };
    }));
    const snapshotFiles = files.filter((file) => file.id !== proposedMemoryId);
    const validation = validateMemoryFiles(snapshotFiles, config.projectId);
    if (validation.quarantined.length > 0 || validation.valid.length !== snapshotFiles.length) {
      throw new Error("Default branch memory snapshot is invalid.");
    }
    const hashes = new Map(manifest.value.memories.map((item) => [item.id, item.contentHash]));
    if (validation.valid.some((item) => hashes.get(item.id) !== sharedMemoryContentHash(item))) {
      throw new Error("Default branch memory snapshot hash mismatch.");
    }
    return validation.valid;
  }

  private async runProjectOperation<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.projectOperations.get(projectId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => completion);
    this.projectOperations.set(projectId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (this.projectOperations.get(projectId) === tail) this.projectOperations.delete(projectId);
    }
  }

  private async findExistingPullRequest(
    config: CollaborationProjectConfig,
    branch: string,
    memoryId: string,
  ): Promise<CollaborationProposal["review"] | undefined> {
    try {
      const result = await this.github.listOpenPullRequests(repositoryAddress(config.repository), branch);
      const pullRequests = parsePullRequests(result);
      const marker = `<!-- openmembrane:memory=${memoryId} -->`;
      const match = pullRequests.find((pullRequest) => pullRequest.body.includes(marker));
      return match === undefined ? undefined : {
        provider: "github",
        id: match.number,
        url: match.url,
        branch,
      };
    } catch {
      return undefined;
    }
  }

  private async runPublicationCommand(command: Promise<CommandResult>): Promise<void> {
    if (!succeeded(await command)) throw new Error("GitHub publication command failed.");
  }

  private failedProposal(proposal: CollaborationProposal, timestamp: string): CollaborationProposal {
    const attempts = proposal.retry.attempts + 1;
    return {
      ...proposal,
      state: "sync_failed",
      retry: {
        status: "scheduled",
        attempts,
        lastAttemptAt: timestamp,
        nextAttemptAt: new Date(Date.parse(timestamp) + retryDelayMs(attempts)).toISOString(),
        failureCode: "GITHUB_PUBLICATION_FAILED",
      },
      updatedAt: timestamp,
    };
  }

  private async recordPublicationFailure(projectId: string): Promise<void> {
    try {
      await this.diagnosticsLogStore.append({
        id: createId("diag"),
        projectId,
        severity: "error",
        code: "GITHUB_PUBLICATION_FAILED",
        message: "OpenMembrane could not publish the memory proposal; a retry has been scheduled.",
        operation: "publish_github_memory",
        source: "adapter",
        createdAt: this.now(),
      });
    } catch {
      // Diagnostic-storage failure must not discard durable retry state.
    }
  }

  private async reject(
    projectId: string,
    code: GitHubTeamConfigurationErrorCode,
    message: string,
  ): Promise<ConfigureGitHubTeamResult> {
    try {
      await this.diagnosticsLogStore.append({
        id: createId("diag"),
        projectId,
        severity: "error",
        code,
        message,
        operation: "configure_github_team",
        source: "adapter",
        createdAt: this.now(),
      });
    } catch {
      // A diagnostic-storage failure must not change a safe configuration outcome.
    }
    return { kind: "rejected", code, message };
  }
}

function validateConfigureInput(input: ConfigureGitHubTeamInput): string | undefined {
  if (!isSafeProjectId(input.projectId)) {
    return "The project ID is invalid for a local collaboration checkout.";
  }
  if (!isHost(input.repository.host) || !isRepositoryPart(input.repository.owner) || !isRepositoryPart(input.repository.name)) {
    return "The selected GitHub repository identity is invalid.";
  }
  return undefined;
}

function isSafeProjectId(projectId: string): boolean {
  return projectId.trim() === projectId && projectId.length > 0 && !/[\\/\0]/.test(projectId) && projectId !== "." && projectId !== "..";
}

function isHost(host: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$/.test(host) || /^[A-Za-z0-9]$/.test(host);
}

function isRepositoryPart(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/.test(value);
}

function repositoryAddress(repository: ConfigureGitHubTeamInput["repository"]): string {
  return `${repository.host}/${repository.owner}/${repository.name}`;
}

function repositoryUrl(repository: ConfigureGitHubTeamInput["repository"]): string {
  return `https://${repositoryAddress(repository)}`;
}

function sharedMemory(entry: MemoryEntry): SharedMemoryEntry {
  const { source: _source, ...memory } = entry;
  return memory;
}

function proposalDescription(memory: SharedMemoryEntry, change: "create" | "update" | "remove"): string {
  return [
    `<!-- openmembrane:memory=${memory.id} -->`,
    "",
    "OpenMembrane memory proposal.",
    "",
    `- Memory ID: \`${memory.id}\``,
    `- Type: \`${memory.type}\``,
    `- Scope: \`${memory.scope}\``,
    `- Change: \`${change}\``,
    "",
  ].join("\n");
}

function parsePullRequestUrl(stdout: string): string | undefined {
  const url = stdout.trim();
  return /^https:\/\/[^\s/]+\/.+\/pull\/\d+$/.test(url) ? url : undefined;
}

function parsePullRequests(result: CommandResult): GitHubPullRequestView[] {
  if (!succeeded(result)) return [];
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): GitHubPullRequestView[] => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
      const pullRequest = value as Record<string, unknown>;
      return typeof pullRequest.number === "number" &&
        typeof pullRequest.url === "string" &&
        typeof pullRequest.body === "string" &&
        /^https:\/\/[^\s/]+\/.+\/pull\/\d+$/.test(pullRequest.url)
        ? [{ number: String(pullRequest.number), url: pullRequest.url, body: pullRequest.body }]
        : [];
    });
  } catch {
    return [];
  }
}

interface PullRequestRefreshView {
  state: "OPEN" | "CLOSED" | "MERGED";
  mergedAt?: string;
  mergeCommit?: string;
  closedAt?: string;
  closedBy?: string;
  reviewDecision?: "CHANGES_REQUESTED";
}

interface SnapshotImportResult {
  complete: boolean;
  importedIds: Set<string>;
  removedIds: Set<string>;
}

function incompleteSnapshot(): SnapshotImportResult {
  return { complete: false, importedIds: new Set(), removedIds: new Set() };
}

function parsePullRequestView(result: CommandResult): PullRequestRefreshView | undefined {
  if (!succeeded(result)) return undefined;
  try {
    const value: unknown = JSON.parse(result.stdout);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const pullRequest = value as Record<string, unknown>;
    if (pullRequest.state !== "OPEN" && pullRequest.state !== "CLOSED" && pullRequest.state !== "MERGED") return undefined;
    const mergeCommit = pullRequest.mergeCommit;
    const closedBy = pullRequest.closedBy;
    if (!optionalString(pullRequest.mergedAt) ||
      !optionalString(pullRequest.closedAt) ||
      (mergeCommit !== null && !isOidObject(mergeCommit)) ||
      (closedBy !== null && !isLoginObject(closedBy)) ||
      (pullRequest.reviewDecision !== null && pullRequest.reviewDecision !== "CHANGES_REQUESTED")) {
      return undefined;
    }
    return {
      state: pullRequest.state,
      ...(typeof pullRequest.mergedAt === "string" ? { mergedAt: pullRequest.mergedAt } : {}),
      ...(isOidObject(mergeCommit) ? { mergeCommit: mergeCommit.oid } : {}),
      ...(typeof pullRequest.closedAt === "string" ? { closedAt: pullRequest.closedAt } : {}),
      ...(isLoginObject(closedBy) ? { closedBy: closedBy.login } : {}),
      ...(pullRequest.reviewDecision === "CHANGES_REQUESTED" ? { reviewDecision: pullRequest.reviewDecision } : {}),
    };
  } catch {
    return undefined;
  }
}

function parseCommit(result: CommandResult): string | undefined {
  const commit = succeeded(result) ? result.stdout.trim() : "";
  return /^[0-9a-f]{7,64}$/i.test(commit) ? commit : undefined;
}

function parseChangedFiles(result: CommandResult): { manifestChanged: boolean; memoryPaths: Set<string> } | undefined {
  if (!succeeded(result)) return undefined;
  let manifestChanged = false;
  const memoryPaths = new Set<string>();
  for (const line of result.stdout.split("\n")) {
    const [, path] = line.split("\t", 2);
    if (path === ".openmembrane/manifest.json") {
      manifestChanged = true;
    } else if (path?.startsWith(".openmembrane/memories/") && path.endsWith(".json")) {
      memoryPaths.add(path);
    } else if (path !== undefined) {
      return undefined;
    }
  }
  return { manifestChanged, memoryPaths };
}

function memoryIdFromPath(path: string): string {
  return path.slice(".openmembrane/memories/".length, -".json".length);
}

function duplicateManifestIds(ids: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return duplicates;
}

function sameSharedMemory(current: MemoryEntry, remote: SharedMemoryEntry): boolean {
  const { source: _source, ...shared } = current;
  return JSON.stringify(shared) === JSON.stringify(remote);
}

function isSupersededProposalStaging(
  current: MemoryEntry,
  proposal: CollaborationProposal | undefined,
  remote: SharedMemoryEntry,
): boolean {
  return current.status === "superseded" &&
    proposal?.state === "proposed" &&
    proposal.operation !== "remove" &&
    JSON.stringify(proposal.memory) === JSON.stringify(remote);
}

function optionalString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string";
}

function isOidObject(value: unknown): value is { oid: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).oid === "string";
}

function isLoginObject(value: unknown): value is { login: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).login === "string";
}

function pullRequestId(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

function proposalBranch(memoryId: string, timestamp: string, replacement: boolean): string {
  if (!replacement) return `openmembrane/memory/${memoryId}`;
  return `openmembrane/memory/${memoryId}/${timestamp.replace(/[:.]/g, "-")}`;
}

function retryDelayMs(attempts: number): number {
  return Math.min(retryBaseDelayMs * 2 ** (attempts - 1), retryMaxDelayMs);
}

function collaborationCheckoutPath(storageDir: string, projectId: string): string {
  return join(storageDir, "collaboration", "repos", projectId);
}

function succeeded(result: CommandResult): boolean {
  return result.exitCode === 0;
}

function parseRepositoryView(result: CommandResult, expectedNameWithOwner: string): GitHubRepositoryView | undefined {
  if (!succeeded(result)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const view = parsed as Record<string, unknown>;
    const defaultBranch = view.defaultBranch;
    if (view.nameWithOwner !== expectedNameWithOwner ||
      typeof view.isPrivate !== "boolean" ||
      typeof view.url !== "string" ||
      (defaultBranch !== null &&
        (typeof defaultBranch !== "object" || Array.isArray(defaultBranch)))) {
      return undefined;
    }
    if (defaultBranch === null) {
      return { nameWithOwner: view.nameWithOwner, isPrivate: view.isPrivate, defaultBranch: null, url: view.url };
    }
    const name = (defaultBranch as Record<string, unknown>).name;
    if (typeof name !== "string" || name.trim() === "") {
      return undefined;
    }
    return {
      nameWithOwner: view.nameWithOwner,
      isPrivate: view.isPrivate,
      defaultBranch: { name },
      url: view.url,
    };
  } catch {
    return undefined;
  }
}
