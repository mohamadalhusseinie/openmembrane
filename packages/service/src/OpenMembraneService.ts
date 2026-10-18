import { env } from "node:process";
import { rankMemories } from "@openmembrane/core";
import type { AuditEvent, MemoryEntry, MemoryScope, MemorySearchOptions, MemoryType } from "@openmembrane/core";
import { createStores } from "@openmembrane/storage";
import type { StoreSet, StorageBackend } from "@openmembrane/storage";
import { createProjectState, resolveProjectRef } from "./factory";
import type { CreateServiceOptions, ProjectRef, ProjectState } from "./factory";
import { createProjectOperations } from "./operations";
import { canonicalStoragePath } from "./storagePath";

export type ProjectService = ReturnType<typeof createProjectOperations> & {
  projectId: string;
  storageDir: string;
  listMemories: (options?: { query?: string; types?: MemoryType[]; scopes?: MemoryScope[]; limit?: number }) => Promise<MemoryEntry[]>;
  getMemory: (id: string) => Promise<MemoryEntry | undefined>;
  getCliContext: (options?: { query?: string; type?: MemoryType; scope?: MemoryScope }) => Promise<MemoryEntry[]>;
  pendingCandidateCount: () => Promise<number>;
  listReviewAuditLog: (limit: number) => Promise<AuditEvent[]>;
  retryEligiblePublications: () => Promise<void>;
  checkCollaborationAvailability: () => ReturnType<ProjectState["githubTeamService"]["checkAvailability"]>;
  listCandidates: (options?: { limit?: number }) => ReturnType<ReturnType<typeof createProjectOperations>["listMemoryCandidates"]>;
  approveCandidate: (input: { candidateId: string }) => ReturnType<ReturnType<typeof createProjectOperations>["approveMemoryCandidate"]>;
  rejectCandidate: (input: { candidateId: string; reason?: string }) => ReturnType<ReturnType<typeof createProjectOperations>["rejectMemoryCandidate"]>;
};

export class OpenMembraneService {
  private readonly stores = new Map<string, Promise<StoreSet>>();
  private readonly projects = new Map<string, Promise<{ service: ProjectService; state: ProjectState }>>();
  private closed = false;

  constructor(private readonly options: CreateServiceOptions = {}) {}

  async forProject(ref: ProjectRef): Promise<ProjectService> {
    return (await this.project(ref)).service;
  }

  // Exposes service-owned state for integration fixtures.
  async projectState(ref: ProjectRef): Promise<ProjectState> {
    return (await this.project(ref)).state;
  }

  private async project(ref: ProjectRef): Promise<{ service: ProjectService; state: ProjectState }> {
    if (this.closed) throw new Error("OpenMembraneService is closed.");
    const resolved = resolveProjectRef(ref);
    resolved.storageDir = await canonicalStoragePath(resolved.storageDir);
    if (this.closed) throw new Error("OpenMembraneService is closed.");
    const backend: StorageBackend = ref.storageBackend ?? (env.OPENMEMBRANE_STORAGE_BACKEND === "sqlite" ? "sqlite" : "json");
    const storeKey = JSON.stringify([resolved.storageDir, backend]);
    const key = JSON.stringify([storeKey, resolved.projectRoot, resolved.projectId]);
    let promise = this.projects.get(key);
    if (!promise) {
      let stores = this.stores.get(storeKey);
      if (!stores) {
        stores = createStores({ backend, baseDir: resolved.storageDir });
        this.stores.set(storeKey, stores);
        void stores.catch(() => this.stores.delete(storeKey));
      }
      promise = stores.then(async (storeSet) => {
        const state = await createProjectState(resolved, this.options, storeSet);
        const operations = createProjectOperations(state);
        const service: ProjectService = {
          ...operations,
          projectId: resolved.projectId,
          storageDir: resolved.storageDir,
          async listMemories(options = {}) {
            await state.githubTeamService.refreshBeforeRetrieval(resolved.projectId);
            const query: MemorySearchOptions = {};
            if (options.types) query.types = options.types;
            if (options.scopes) query.scopes = options.scopes;
            if (options.limit !== undefined) query.limit = options.limit;
            if (options.query) {
              const matches = await state.memoryStore.search(resolved.projectId, options.query, { ...query, limit: null });
              return matches.filter((memory) => memory.status === "active").slice(0, options.limit ?? 20);
            }
            const memories = await state.memoryStore.list(resolved.projectId);
            return memories.filter((memory) =>
              memory.status === "active" &&
              (!options.types || options.types.includes(memory.type)) &&
              (!options.scopes || options.scopes.includes(memory.scope))
            ).slice(0, options.limit);
          },
          async getMemory(id) {
            await state.githubTeamService.refreshBeforeRetrieval(resolved.projectId);
            return state.memoryStore.findById(resolved.projectId, id);
          },
          async getCliContext(options = {}) {
            await state.githubTeamService.refreshBeforeRetrieval(resolved.projectId);
            let memories = options.query
              ? await state.memoryStore.search(resolved.projectId, options.query, {
                ...(options.type ? { types: [options.type] } : {}),
                ...(options.scope ? { scopes: [options.scope] } : {}),
              })
              : await state.memoryStore.list(resolved.projectId);
            if (!options.query) {
              if (options.type) memories = memories.filter((memory) => memory.type === options.type);
              if (options.scope) memories = memories.filter((memory) => memory.scope === options.scope);
            }
            memories = memories.filter((memory) => memory.status === "active");
            return options.query && memories.length > 0
              ? rankMemories(memories, options.query, "context").map((scored) => scored.entry)
              : memories;
          },
          async pendingCandidateCount() {
            return (await state.pendingCandidateStore.list(resolved.projectId)).length;
          },
          listReviewAuditLog: (limit) => operations.listAuditLog({ limit, order: "append" }),
          async retryEligiblePublications() {
            await state.githubTeamService.retryEligiblePublications(resolved.projectId);
          },
          checkCollaborationAvailability: () => state.githubTeamService.checkAvailability(resolved.projectId),
          async listCandidates(input = {}) {
            const candidates = await state.pendingCandidateStore.list(resolved.projectId);
            return candidates.slice(0, input.limit);
          },
          approveCandidate: (input) => operations.approveMemoryCandidate(input),
          rejectCandidate: (input) => operations.rejectMemoryCandidate(input),
        };
        return { service, state };
      });
      this.projects.set(key, promise);
      void promise.catch(() => this.projects.delete(key));
    }
    return promise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled(this.projects.values());
    const results = await Promise.allSettled([...this.stores.values()].map(async (stores) => (await stores).close?.()));
    this.projects.clear();
    this.stores.clear();
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) throw new AggregateError(failures.map((result) => result.reason), "Failed to close project stores.");
  }
}

export function createOpenMembraneService(options: CreateServiceOptions = {}): OpenMembraneService {
  return new OpenMembraneService(options);
}
