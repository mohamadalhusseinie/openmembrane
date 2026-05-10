# Memory Expiration and Staleness Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add memory supersession and staleness handling so the memory store does not accumulate outdated knowledge.

**Architecture:** Expand `MemoryEntry.status` to support `"superseded"`. The `ConflictDetector` returns typed results so the pipeline can auto-supersede clear-cut conflicts. Two new MCP tools: `supersede_memory` for manual supersession, `review_stale_memories` for time-based review. Approval of conflicting candidates auto-supersedes old memories.

**Tech Stack:** TypeScript, Vitest, existing `@openmembrain/core`, `@openmembrain/storage`, `@openmembrain/shared`.

---

## File Structure

### Modified files:
- `packages/core/src/types/MemoryEntry.ts` — Expand status, add supersession fields
- `packages/core/src/types/Storage.ts` — Add `supersede()` to MemoryStore, add audit type
- `packages/core/src/errors/OpenMembrainError.ts` — Add error codes
- `packages/core/src/deduplication/ConflictDetector.ts` — Return `ConflictResult[]` with `kind`
- `packages/core/src/pipeline/MemoryPipeline.ts` — Auto-supersede on clear-cut conflicts
- `packages/core/src/pipeline/MemoryApprovalService.ts` — Supersede conflicts on approval
- `packages/core/src/index.ts` — Export new types
- `packages/storage/src/MemoryStore.ts` — Implement `supersede()`
- `apps/mcp-server/src/tools/schemas.ts` — New tool schemas
- `apps/mcp-server/src/tools/handlers.ts` — New handler functions + types
- `apps/mcp-server/src/server.ts` — Register two new tools

### Modified test files:
- `tests/unit/helpers.ts` — Update `entry()` helper for new status type
- `tests/unit/ConflictDetector.test.ts` — Update for `ConflictResult[]` return type

### New test files:
- `tests/unit/MemoryStore.supersede.test.ts`
- `tests/unit/MemorySupersession.test.ts`

---

## Task 1: Error codes + MemoryEntry schema changes

**Files:**
- Modify: `packages/core/src/errors/OpenMembrainError.ts`
- Modify: `packages/core/src/types/MemoryEntry.ts`
- Modify: `tests/unit/helpers.ts`

- [ ] **Step 1: Add MEMORY_NOT_FOUND and MEMORY_ALREADY_SUPERSEDED to OpenMembrainErrorCode**

Add two new codes to the union type in `packages/core/src/errors/OpenMembrainError.ts`:

```ts
export type OpenMembrainErrorCode =
  | "VALIDATION_ERROR"
  | "CANDIDATE_NOT_FOUND"
  | "SECRET_CANDIDATE"
  | "EXPORT_PATH_OUTSIDE_ROOT"
  | "STORAGE_INVALID_JSON"
  | "EXTRACTION_CONFIG_ERROR"
  | "EXTRACTION_PROVIDER_ERROR"
  | "MEMORY_NOT_FOUND"
  | "MEMORY_ALREADY_SUPERSEDED"
  | "UNKNOWN_ERROR";
```

- [ ] **Step 2: Expand MemoryEntry.status and add supersession fields**

In `packages/core/src/types/MemoryEntry.ts`, add exported status constants and expand the interface:

```ts
export const memoryStatuses = ["active", "superseded"] as const;
export type MemoryStatus = (typeof memoryStatuses)[number];

export interface MemoryEntry {
  id: string;
  projectId: string;
  type: MemoryType;
  content: string;
  scope: MemoryScope;
  confidence: Confidence;
  sensitivity: Exclude<Sensitivity, "secret">;
  source: MemorySource;
  reason: string;
  tags: string[];
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  supersededBy?: string;
  supersededAt?: string;
}
```

The `memoryEntryFromCandidate` function already sets `status: "active"` — no change needed there.

- [ ] **Step 3: Export MemoryStatus from core index**

Add to `packages/core/src/index.ts` — the existing `export * from "./types/MemoryEntry"` already covers `memoryStatuses` and `MemoryStatus` since they are named exports.

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: All existing tests pass (schema is backward-compatible).

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: expand MemoryEntry status to support superseded memories"
```

---

## Task 2: Storage interface + JsonMemoryStore.supersede()

**Files:**
- Modify: `packages/core/src/types/Storage.ts`
- Modify: `packages/storage/src/MemoryStore.ts`
- Create: `tests/unit/MemoryStore.supersede.test.ts`

- [ ] **Step 1: Add memory_superseded audit type and supersede() to MemoryStore interface**

In `packages/core/src/types/Storage.ts`:

Add `"memory_superseded"` to the `AuditEvent.type` union:

```ts
export interface AuditEvent {
  id: string;
  projectId: string;
  type:
    | "session_ingested"
    | "candidate_extracted"
    | "memory_saved"
    | "candidate_queued"
    | "candidate_rejected"
    | "memory_superseded";
  entityId?: string;
  createdAt: string;
  details?: Record<string, unknown>;
}
```

Add `supersede()` to the `MemoryStore` interface:

```ts
export interface MemoryStore {
  list(projectId: string): Promise<MemoryEntry[]>;
  findById(projectId: string, memoryId: string): Promise<MemoryEntry | undefined>;
  save(entry: MemoryEntry): Promise<MemoryEntry>;
  search(projectId: string, query: string, options?: MemorySearchOptions): Promise<MemoryEntry[]>;
  supersede(projectId: string, memoryId: string, supersededBy?: string): Promise<MemoryEntry>;
}
```

- [ ] **Step 2: Implement supersede() in JsonMemoryStore**

In `packages/storage/src/MemoryStore.ts`, add the `supersede` method:

```ts
async supersede(projectId: string, memoryId: string, supersededBy?: string): Promise<MemoryEntry> {
  const rows = await readJsonArray<MemoryEntry>(this.filePath);
  const index = rows.findIndex((memory) => memory.id === memoryId && memory.projectId === projectId);
  if (index < 0) {
    throw new OpenMembrainError({
      code: "MEMORY_NOT_FOUND",
      message: `Memory ${memoryId} was not found.`,
      safeMessage: "The memory was not found.",
      details: { memoryId }
    });
  }

  const memory = rows[index]!;
  if (memory.status === "superseded") {
    throw new OpenMembrainError({
      code: "MEMORY_ALREADY_SUPERSEDED",
      message: `Memory ${memoryId} is already superseded.`,
      safeMessage: "The memory is already superseded.",
      details: { memoryId }
    });
  }

  const updated: MemoryEntry = {
    ...memory,
    status: "superseded",
    supersededAt: nowIso(),
    ...(supersededBy !== undefined ? { supersededBy } : {})
  };
  rows[index] = updated;
  await writeJsonArray(this.filePath, rows);
  return updated;
}
```

Import `OpenMembrainError` from `@openmembrain/core` and `nowIso` from `@openmembrain/shared`.

- [ ] **Step 3: Write tests for supersede()**

Create `tests/unit/MemoryStore.supersede.test.ts`:

Test cases:
- supersedes an active memory and returns updated entry with status "superseded"
- sets supersededBy when provided
- sets supersededAt timestamp
- throws MEMORY_NOT_FOUND when memory does not exist
- throws MEMORY_ALREADY_SUPERSEDED when memory is already superseded
- superseded memory is excluded from list()
- superseded memory is excluded from search()

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add supersede() method to MemoryStore"
```

---

## Task 3: ConflictDetector — typed conflict results

**Files:**
- Modify: `packages/core/src/deduplication/ConflictDetector.ts`
- Modify: `tests/unit/ConflictDetector.test.ts`

- [ ] **Step 1: Add ConflictResult type and refactor findConflicts return type**

In `packages/core/src/deduplication/ConflictDetector.ts`:

Add type definitions:

```ts
export const conflictKinds = ["version_mismatch", "alternative", "negation"] as const;
export type ConflictKind = (typeof conflictKinds)[number];

export interface ConflictResult {
  memory: MemoryEntry;
  kind: ConflictKind;
}
```

Refactor `findConflicts` to return `ConflictResult[]` instead of `MemoryEntry[]`. The logic stays the same but each match now includes its `kind`:

```ts
findConflicts(candidate: MemoryCandidate, existing: MemoryEntry[]): ConflictResult[] {
  const candidateTokens = importantTokens(candidate.content);
  const candidateNegated = hasNegation(candidate.content);
  const results: ConflictResult[] = [];

  for (const memory of existing) {
    if (memory.projectId !== candidate.projectId) continue;
    if (memory.scope !== candidate.scope && memory.scope !== "global" && candidate.scope !== "global") continue;

    const memoryTokens = importantTokens(memory.content);
    const overlap = tokenOverlap(candidateTokens, memoryTokens);
    const memoryNegated = hasNegation(memory.content);

    if (
      overlap >= 0.45 &&
      candidateNegated !== memoryNegated &&
      !mentionsDifferentAlternatives(candidate.content, memory.content)
    ) {
      results.push({ memory, kind: "negation" });
      continue;
    }

    const alternativeKind = getAlternativeConflictKind(candidate.content, memory.content, candidateTokens, memoryTokens);
    if (alternativeKind) {
      results.push({ memory, kind: alternativeKind });
    }
  }

  return results;
}
```

Extract a `getAlternativeConflictKind` helper from the existing `hasAlternativeConflict` that returns the specific kind or undefined:

```ts
function getAlternativeConflictKind(
  candidateContent: string,
  memoryContent: string,
  candidateTokens: Set<string>,
  memoryTokens: Set<string>
): ConflictKind | undefined {
  if (hasNegation(candidateContent) || hasNegation(memoryContent)) return undefined;
  if (!hasSharedContext(candidateTokens, memoryTokens) && !hasMatchingDirective(candidateContent, memoryContent)) return undefined;

  if (hasDifferentNodeVersion(candidateContent, memoryContent)) return "version_mismatch";
  if (alternativeGroups.some((group) => hasDifferentAlternatives(candidateContent, memoryContent, group))) return "alternative";

  return undefined;
}
```

- [ ] **Step 2: Update existing ConflictDetector tests**

In `tests/unit/ConflictDetector.test.ts`, update all assertions from `conflicts[0]` (MemoryEntry) to `conflicts[0].memory` and add `kind` checks:

- Negation tests: verify `kind === "negation"`
- Alternative framework tests: verify `kind === "alternative"`
- Version mismatch tests: verify `kind === "version_mismatch"`

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "feat: return typed ConflictResult from ConflictDetector"
```

---

## Task 4: Pipeline auto-supersession

**Files:**
- Modify: `packages/core/src/pipeline/MemoryPipeline.ts`
- Modify: `tests/memoryPipeline.test.ts`

- [ ] **Step 1: Update pipeline to use ConflictResult[]**

In `packages/core/src/pipeline/MemoryPipeline.ts`:

Import `ConflictResult` type. Update the conflict detection section to use the new return type. Add a helper:

```ts
function allClearCut(conflicts: ConflictResult[]): boolean {
  return conflicts.every((c) => c.kind === "version_mismatch" || c.kind === "alternative");
}
```

- [ ] **Step 2: Add auto-supersession logic**

After conflict detection, when conflicts exist and `allClearCut(conflicts)` and candidate confidence is "high":
1. Supersede each conflicting memory via `this.memoryStore.supersede()`
2. Log `memory_superseded` audit event for each
3. Remove superseded memories from the `existing` array
4. Let the candidate proceed through normal recommendation (which will be `auto_save` since `hasConflict` should be false now — the conflicts have been resolved)

When conflicts are NOT all clear-cut or candidate confidence is not "high": keep current behavior (set `conflictWith`, pass `hasConflict: true` to recommender).

Add `superseded: MemoryEntry[]` to `MemoryPipelineResult`.

- [ ] **Step 3: Update existing pipeline integration test**

The test "queues conflicting auto-save candidates" uses React vs Angular (alternative conflict). With auto-supersession, a high-confidence candidate should now auto-supersede the old memory instead of being queued. Update the test accordingly.

- [ ] **Step 4: Add new pipeline test for ambiguous conflict**

Add a test that verifies negation-based conflicts still route to `ask_user`.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "feat: auto-supersede clear-cut conflicts in pipeline"
```

---

## Task 5: Approval service — supersede on approve

**Files:**
- Modify: `packages/core/src/pipeline/MemoryApprovalService.ts`
- Modify: `tests/unit/MemoryApprovalService.test.ts`

- [ ] **Step 1: Add supersession on approve when conflictWith is set**

In `MemoryApprovalService.approve()`, after saving the new memory entry, check if the original candidate had `conflictWith`. If so, supersede each conflicting memory and log audit events:

```ts
if (candidate.conflictWith && candidate.conflictWith.length > 0) {
  for (const conflictId of candidate.conflictWith) {
    try {
      await this.memoryStore.supersede(projectId, conflictId, memory.id);
      await this.auditLogStore.append({
        id: createId("audit"),
        projectId,
        type: "memory_superseded",
        entityId: conflictId,
        createdAt: nowIso(),
        details: { supersededBy: memory.id, reason: "Superseded by approved candidate." }
      });
    } catch {
      // Conflicting memory may already be superseded or removed — skip silently.
    }
  }
}
```

- [ ] **Step 2: Write tests**

Add tests to `tests/unit/MemoryApprovalService.test.ts`:
- Approving a candidate with `conflictWith` supersedes the conflicting memory
- Superseded memory is excluded from list after approval
- Audit log records `memory_superseded` event
- Approving a candidate without `conflictWith` does not supersede anything

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "feat: supersede conflicting memories on candidate approval"
```

---

## Task 6: supersede_memory MCP tool

**Files:**
- Modify: `apps/mcp-server/src/tools/schemas.ts`
- Modify: `apps/mcp-server/src/tools/handlers.ts`
- Modify: `apps/mcp-server/src/server.ts`

- [ ] **Step 1: Add schema**

In `apps/mcp-server/src/tools/schemas.ts`:

```ts
export const supersedeMemorySchema = {
  ...projectIdSchema,
  memoryId: z.string().min(1).describe("The ID of the memory to supersede."),
  reason: z.string().min(1).optional().describe("Reason for superseding this memory."),
  replacementId: z.string().min(1).optional().describe("ID of the replacement memory, if any.")
};
```

- [ ] **Step 2: Add handler types and function**

In `apps/mcp-server/src/tools/handlers.ts`:

```ts
export interface SupersedeMemoryInput extends ProjectScopedInput {
  memoryId: string;
  reason?: string | undefined;
  replacementId?: string | undefined;
}
```

Add handler:

```ts
supersedeMemory: async (input: SupersedeMemoryInput) => {
  const projectId = resolveProjectId(context, input.projectId);
  const superseded = await context.memoryStore.supersede(projectId, input.memoryId, input.replacementId);
  await context.auditLogStore.append({
    id: createId("audit"),
    projectId,
    type: "memory_superseded",
    entityId: input.memoryId,
    createdAt: nowIso(),
    details: {
      reason: input.reason ?? "Superseded via tool.",
      replacementId: input.replacementId
    }
  });
  return superseded;
}
```

Import `createId`, `nowIso` from `@openmembrain/shared`.

- [ ] **Step 3: Register tool in server.ts**

```ts
server.registerTool(
  "supersede_memory",
  {
    title: "Supersede Memory",
    description: "Mark an existing memory as superseded. Superseded memories are excluded from retrieval but preserved in audit history.",
    inputSchema: supersedeMemorySchema
  },
  async (input) => safeJsonResult(context, "supersede_memory", input, () => handlers.supersedeMemory(input))
);
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add supersede_memory MCP tool"
```

---

## Task 7: review_stale_memories MCP tool

**Files:**
- Modify: `apps/mcp-server/src/tools/schemas.ts`
- Modify: `apps/mcp-server/src/tools/handlers.ts`
- Modify: `apps/mcp-server/src/server.ts`

- [ ] **Step 1: Add schema**

```ts
export const reviewStaleMemoriesSchema = {
  ...projectIdSchema,
  staleAfterMonths: z.number().int().positive().max(120).optional().describe("Memories older than this many months are considered stale. Defaults to 6.")
};
```

- [ ] **Step 2: Add handler types and function**

```ts
export interface ReviewStaleMemoriesInput extends ProjectScopedInput {
  staleAfterMonths?: number | undefined;
}
```

Handler:

```ts
reviewStaleMemories: async (input: ReviewStaleMemoriesInput) => {
  const projectId = resolveProjectId(context, input.projectId);
  const months = input.staleAfterMonths ?? 6;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffIso = cutoff.toISOString();

  const memories = await context.memoryStore.list(projectId);
  return memories
    .filter((memory) => memory.updatedAt < cutoffIso)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}
```

- [ ] **Step 3: Register tool in server.ts**

```ts
server.registerTool(
  "review_stale_memories",
  {
    title: "Review Stale Memories",
    description: "List active memories that have not been updated recently. Useful for reviewing potentially outdated project knowledge.",
    inputSchema: reviewStaleMemoriesSchema
  },
  async (input) => safeJsonResult(context, "review_stale_memories", input, () => handlers.reviewStaleMemories(input))
);
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add review_stale_memories MCP tool"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 3: Final commit if needed**

If any fixes are needed, commit them.
