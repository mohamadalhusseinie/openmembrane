import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  CollaborationCheckpoint,
  CollaborationEvent,
  CollaborationProjectConfig,
  CollaborationStore,
  CollaborationProposal,
} from "@openmembrane/core";
import { readJsonArray, readJsonObject, writeJsonArray, writeJsonObject } from "./jsonFile";

export class JsonCollaborationStore implements CollaborationStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = join(baseDir, "collaboration");
  }

  async getProjectConfig(projectId: string): Promise<CollaborationProjectConfig | undefined> {
    return readJsonObject<CollaborationProjectConfig>(join(this.baseDir, "projects", `${projectId}.json`));
  }

  async saveProjectConfig(config: CollaborationProjectConfig): Promise<CollaborationProjectConfig> {
    const persistedConfig: CollaborationProjectConfig = {
      projectId: config.projectId,
      mode: config.mode,
      repository: {
        host: config.repository.host,
        owner: config.repository.owner,
        name: config.repository.name,
        defaultBranch: config.repository.defaultBranch,
      },
      checkoutPath: config.checkoutPath,
      ...(config.repositoryInitialized === undefined ? {} : { repositoryInitialized: config.repositoryInitialized }),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
    await writeJsonObject(join(this.baseDir, "projects", `${config.projectId}.json`), persistedConfig);
    return config;
  }

  async getProposal(projectId: string, memoryId: string): Promise<CollaborationProposal | undefined> {
    return readJsonObject<CollaborationProposal>(join(this.baseDir, "proposals", projectId, `${memoryId}.json`));
  }

  async listProposals(projectId: string): Promise<CollaborationProposal[]> {
    const proposalDir = join(this.baseDir, "proposals", projectId);
    let fileNames: string[];
    try {
      fileNames = await readdir(proposalDir);
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }

    const proposals = await Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
        .map((fileName) => readJsonObject<CollaborationProposal>(join(proposalDir, fileName))),
    );
    return proposals.filter((proposal): proposal is CollaborationProposal => proposal !== undefined);
  }

  async saveProposal(proposal: CollaborationProposal): Promise<CollaborationProposal> {
    await writeJsonObject(join(this.baseDir, "proposals", proposal.projectId, `${proposal.memory.id}.json`), proposal);
    return proposal;
  }

  async listEvents(projectId: string): Promise<CollaborationEvent[]> {
    return readJsonArray<CollaborationEvent>(join(this.baseDir, "events", `${projectId}.json`));
  }

  async appendEvent(event: CollaborationEvent): Promise<void> {
    const events = await this.listEvents(event.projectId);
    await writeJsonArray(join(this.baseDir, "events", `${event.projectId}.json`), [...events, event]);
  }

  async getCheckpoint(projectId: string): Promise<CollaborationCheckpoint | undefined> {
    return readJsonObject<CollaborationCheckpoint>(join(this.baseDir, "checkpoints", `${projectId}.json`));
  }

  async saveCheckpoint(checkpoint: CollaborationCheckpoint): Promise<CollaborationCheckpoint> {
    await writeJsonObject(join(this.baseDir, "checkpoints", `${checkpoint.projectId}.json`), checkpoint);
    return checkpoint;
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
