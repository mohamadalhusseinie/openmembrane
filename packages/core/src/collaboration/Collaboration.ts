import type { Confidence, MemoryScope, MemoryType, Sensitivity } from "../types/MemoryCandidate";
import type { MemoryStatus } from "../types/MemoryEntry";

export const collaborationModes = ["local_private", "github_team", "self_hosted_team", "managed_team"] as const;
export type CollaborationMode = (typeof collaborationModes)[number];

export const proposalStates = ["proposed", "active", "rejected", "sync_failed", "conflict"] as const;
export type ProposalState = (typeof proposalStates)[number];

export const retryStatuses = ["not_scheduled", "scheduled", "in_progress"] as const;
export type RetryStatus = (typeof retryStatuses)[number];

export const collaborationEventTypes = [
  "proposal_created",
  "review_created",
  "review_updated",
  "review_changes_requested",
  "review_merged",
  "review_closed",
  "memory_imported",
  "memory_removed",
  "memory_quarantined",
  "memory_conflicted",
  "retry_scheduled",
] as const;
export type CollaborationEventType = (typeof collaborationEventTypes)[number];

export interface CollaborationRepository {
  host: string;
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface CollaborationProjectConfig {
  projectId: string;
  mode: CollaborationMode;
  repository: CollaborationRepository;
  checkoutPath: string;
  /** False only until an empty repository receives its initial default-branch metadata commit. */
  repositoryInitialized?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SharedMemoryEntry {
  id: string;
  projectId: string;
  type: MemoryType;
  content: string;
  scope: MemoryScope;
  confidence: Confidence;
  sensitivity: Exclude<Sensitivity, "secret">;
  reason: string;
  tags: string[];
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  supersededBy?: string;
  supersededAt?: string;
}

export const collaborationReviewProviders = ["github", "self_hosted", "managed"] as const;
export type CollaborationReviewProvider = (typeof collaborationReviewProviders)[number];

export interface CollaborationReview {
  provider: CollaborationReviewProvider;
  id: string;
  url: string;
  branch: string;
  mergedAt?: string;
  mergedCommit?: string;
  closedAt?: string;
  closedBy?: string;
}

export interface ProposalRetryState {
  status: RetryStatus;
  attempts: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  failureCode?: string;
}

export interface CollaborationProposal {
  projectId: string;
  memory: SharedMemoryEntry;
  operation?: "upsert" | "remove";
  removalMemoryIds?: string[];
  state: ProposalState;
  review?: CollaborationReview;
  retry: ProposalRetryState;
  createdAt: string;
  updatedAt: string;
}

export interface CollaborationEvent {
  id: string;
  projectId: string;
  memoryId?: string;
  type: CollaborationEventType;
  createdAt: string;
}

export interface CollaborationCheckpoint {
  projectId: string;
  defaultBranchCommit: string;
  syncedAt: string;
}

export interface CollaborationStore {
  getProjectConfig(projectId: string): Promise<CollaborationProjectConfig | undefined>;
  saveProjectConfig(config: CollaborationProjectConfig): Promise<CollaborationProjectConfig>;
  getProposal(projectId: string, memoryId: string): Promise<CollaborationProposal | undefined>;
  listProposals(projectId: string): Promise<CollaborationProposal[]>;
  saveProposal(proposal: CollaborationProposal): Promise<CollaborationProposal>;
  listEvents(projectId: string): Promise<CollaborationEvent[]>;
  appendEvent(event: CollaborationEvent): Promise<void>;
  getCheckpoint(projectId: string): Promise<CollaborationCheckpoint | undefined>;
  saveCheckpoint(checkpoint: CollaborationCheckpoint): Promise<CollaborationCheckpoint>;
}
