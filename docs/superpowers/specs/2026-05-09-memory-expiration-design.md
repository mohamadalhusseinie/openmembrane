# Memory Expiration and Staleness Handling — Design Spec

**Issue:** #23
**Goal:** Provide a mechanism for memories to become stale, be superseded, or expire, so the memory store does not accumulate outdated knowledge.

## Problem

Saved memories persist indefinitely. When project facts change (Node version upgrade, testing framework migration, infrastructure changes), outdated memories produce incorrect context for future AI sessions — worse than no memory at all.

## Approach: Status Field on MemoryEntry

Expand `MemoryEntry.status` from the literal `"active"` to `"active" | "superseded"`. Add `supersededBy?: string` and `supersededAt?: string` fields. Superseded memories remain in `memories.json` for audit history but are excluded from all retrieval (`list`, `search`, `getRelevantContext`). Backward-compatible: existing memories default to `"active"`.

## Schema Changes

### MemoryEntry

Expand status, add two optional fields:

```typescript
interface MemoryEntry {
  // ... existing fields ...
  status: "active" | "superseded";    // was: "active"
  supersededBy?: string;               // NEW: ID of replacement memory
  supersededAt?: string;               // NEW: ISO timestamp
}
```

### AuditEvent.type

Add `"memory_superseded"` to the union.

### MemoryStore

Add `supersede()` method:

```typescript
supersede(projectId: string, memoryId: string, supersededBy?: string): Promise<MemoryEntry>
```

### OpenMembrainErrorCode

Add `"MEMORY_NOT_FOUND"` and `"MEMORY_ALREADY_SUPERSEDED"`.

## ConflictDetector: Typed Conflict Results

Change return type from `MemoryEntry[]` to `ConflictResult[]`:

```typescript
type ConflictKind = "version_mismatch" | "alternative" | "negation";

interface ConflictResult {
  memory: MemoryEntry;
  kind: ConflictKind;
}
```

Classification:
- **`version_mismatch`** — `hasDifferentNodeVersion()` returns true
- **`alternative`** — `hasDifferentAlternatives()` returns true
- **`negation`** — opposing negation polarity with high token overlap

## Semi-Automatic Supersession in Pipeline

When processing a new candidate with conflicts:
- If ALL conflicts are clear-cut (`version_mismatch` or `alternative`) AND the candidate is high-confidence: auto-supersede old memories, auto-save the new candidate
- If ANY conflict is ambiguous (`negation`): route to `ask_user` (current behavior)

## Approval Flow Enhancement

When `MemoryApprovalService.approve()` is called for a candidate with `conflictWith`, automatically supersede the conflicting memories. The new memory is the replacement.

## New MCP Tools

### `supersede_memory`

- Input: `memoryId` (required), `reason` (optional), `replacementId` (optional)
- Marks the memory as superseded, logs `memory_superseded` audit event
- Validates: memory exists, is active

### `review_stale_memories`

- Input: `staleAfterMonths` (optional, default 6), `projectId`
- Returns active memories whose `updatedAt` is older than N months ago
- Sorted oldest-first

## Acceptance Criteria (from issue)

1. Outdated memories can be marked as stale/superseded — `supersede_memory` tool + auto-supersession
2. Superseded memories excluded from `get_relevant_context` and `search_memory` — status filtering in `list()`
3. Audit log records supersession events — `memory_superseded` audit type
4. Conflict detection pipeline can trigger automatic supersession — clear-cut conflicts auto-supersede
