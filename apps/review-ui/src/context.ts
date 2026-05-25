import { basename, join, resolve } from "node:path";
import { cwd, env } from "node:process";
import { MemoryApprovalService } from "@openmembrain/core";
import type { AuditLogStore, DiagnosticsLogStore, MemoryStore, PendingCandidateStore } from "@openmembrain/core";
import { createStores } from "@openmembrain/storage";
import type { StorageBackend, StoreSet } from "@openmembrain/storage";

export interface ReviewUiContext {
  projectId: string;
  storageDir: string;
  memoryStore: MemoryStore;
  pendingCandidateStore: PendingCandidateStore;
  auditLogStore: AuditLogStore;
  diagnosticsLogStore: DiagnosticsLogStore;
  approvalService: MemoryApprovalService;
  close?: () => void;
}

export interface ReviewUiOptions {
  port?: number;
  open?: boolean;
  home?: string;
  project?: string;
}

export async function createReviewUiContext(options: ReviewUiOptions = {}): Promise<ReviewUiContext> {
  const workingDirectory = cwd();
  const storageDir = resolve(options.home ?? env.OPENMEMBRAIN_HOME ?? join(workingDirectory, ".openmembrain"));
  const projectId = options.project ?? env.OPENMEMBRAIN_PROJECT_ID ?? basename(workingDirectory);

  const backend: StorageBackend = env.OPENMEMBRAIN_STORAGE_BACKEND === "sqlite" ? "sqlite" : "json";
  const stores: StoreSet = await createStores({ backend, baseDir: storageDir });
  const { memoryStore, pendingCandidateStore, auditLogStore, diagnosticsLogStore } = stores;

  const approvalService = new MemoryApprovalService({
    memoryStore,
    pendingCandidateStore,
    auditLogStore,
  });

  return {
    projectId,
    storageDir,
    memoryStore,
    pendingCandidateStore,
    auditLogStore,
    diagnosticsLogStore,
    approvalService,
    ...(stores.close !== undefined ? { close: stores.close } : {}),
  };
}
