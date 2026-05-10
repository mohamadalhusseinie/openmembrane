# Directory-Based Structured Memory Storage

**Date:** 2026-05-10
**Status:** Approved

## Problem

The current flat `memories.json` file has three compounding problems:

1. **Hard to browse** — a single JSON array with all memories is not navigable by type or scope
2. **Limited search** — basic token matching over the entire array, no structural optimization
3. **Scalability** — every read/write loads and rewrites the entire file as memories accumulate

Both AI tools (via MCP) and human developers need a structured, navigable storage format.

## Solution

Replace the single flat JSON array with a hierarchical directory structure organized by **type then scope**, with index files at each level for fast navigation and querying.

## Directory Layout

```
.openmembrain/
  memories/
    index.json                          # Master index (counts, type/scope summary)
    {type}/
      _index.json                       # Type-level index (entry previews)
      {scope}/
        {id}.json                       # Individual memory file
  pending/
    index.json                          # Same structure for candidates
    {type}/
      _index.json
      {scope}/
        {id}.json
  audit/
    audit-log.json                      # Unchanged
  diagnostics/
    diagnostics-log.json                # Unchanged
```

- Directory names match `MemoryType` enum values (snake_case).
- Scope subdirectories match `MemoryScope` values.
- Each memory is a single `.json` file named by its ID (`mem_abc123.json`).
- Scope directories are created on-demand (only when a memory exists for that scope).
- `pending/` follows the same type/scope structure for candidates.

## Master Index (`memories/index.json`)

```json
{
  "version": 1,
  "lastUpdated": "2026-05-09T14:30:00.000Z",
  "totalCount": 42,
  "byType": {
    "coding_rule": { "count": 15, "scopes": ["frontend", "backend", "global"] },
    "architecture_decision": { "count": 8, "scopes": ["global"] },
    "known_gotcha": { "count": 6, "scopes": ["frontend", "backend"] }
  },
  "byScope": {
    "frontend": { "count": 12, "types": ["coding_rule", "known_gotcha"] },
    "backend": { "count": 9, "types": ["coding_rule", "known_gotcha"] },
    "global": { "count": 21, "types": ["architecture_decision", "coding_rule"] }
  }
}
```

Provides a quick table of contents without scanning the filesystem.

## Type-Level Index (`{type}/_index.json`)

```json
{
  "type": "coding_rule",
  "count": 15,
  "lastUpdated": "2026-05-09T14:30:00.000Z",
  "entries": [
    {
      "id": "mem_abc123",
      "scope": "frontend",
      "content": "Use standalone components instead of NgModules.",
      "confidence": "high",
      "tags": ["angular", "components"],
      "updatedAt": "2026-05-09T12:00:00.000Z"
    }
  ]
}
```

Includes enough fields per entry for search and filter operations without opening individual files.

## Individual Memory File

Each file (e.g. `coding_rule/frontend/mem_abc123.json`) contains a single `MemoryEntry`:

```json
{
  "id": "mem_abc123",
  "projectId": "my-project",
  "type": "coding_rule",
  "content": "Use standalone components instead of NgModules.",
  "scope": "frontend",
  "confidence": "high",
  "sensitivity": "internal",
  "source": {
    "kind": "session",
    "sessionId": "sess_xyz",
    "tool": "claude-code"
  },
  "reason": "Extracted from session discussing Angular migration strategy",
  "tags": ["angular", "components"],
  "status": "active",
  "createdAt": "2026-05-09T10:00:00.000Z",
  "updatedAt": "2026-05-09T12:00:00.000Z",
  "approvedAt": "2026-05-09T11:00:00.000Z"
}
```

Identical schema to the current `MemoryEntry` type — no domain model changes.

## Storage Operations

### Read Operations

- **`list(projectId)`** — read the master `index.json` to know which types exist, then read the relevant `_index.json` files. Filter by projectId from the entries.
- **`findById(projectId, memoryId)`** — scan `_index.json` files to locate the type and scope, then read the individual file directly.
- **`search(projectId, query, options?)`** — read only the `_index.json` files matching the requested `types` and `scopes` filters, run token matching against the entry previews. For full content, read individual files only for matched entries.

### Write Operations

- **`save(entry)`** — write the individual file to `{type}/{scope}/{id}.json`, create directories on-demand, then update both the type-level `_index.json` and the master `index.json` (write-through).
- **`delete/deactivate`** — remove the individual file, update both indexes.

### Index Rebuild

A `rebuildIndexes()` method walks the directory tree, reads all individual memory files, and regenerates all `_index.json` files and the master `index.json`. Called on startup if indexes are missing, or manually if corruption is suspected.

## Pending Candidates

The `pending/` directory mirrors the same type/scope structure. When a candidate is approved, its file is removed from `pending/` and a new `mem_` file is written to `memories/` (both indexes updated). When rejected, the file is removed from `pending/` and the rejection is logged in audit.

The `PendingCandidateStore` interface stays unchanged.

## Migration from Current Format

1. Detect legacy `memories.json` file on startup.
2. Read all entries from the flat array.
3. Write each entry to the correct `{type}/{scope}/{id}.json` path.
4. Generate all index files.
5. Rename `memories.json` to `memories.json.backup`.
6. Migration runs once automatically on first use of the new storage layer.

Same process for `pending-candidates.json`.

## Interface Compatibility

The `MemoryStore` and `PendingCandidateStore` interfaces stay unchanged:

```ts
interface MemoryStore {
  list(projectId: string): Promise<MemoryEntry[]>;
  findById(projectId: string, memoryId: string): Promise<MemoryEntry | undefined>;
  save(entry: MemoryEntry): Promise<MemoryEntry>;
  search(projectId: string, query: string, options?: MemorySearchOptions): Promise<MemoryEntry[]>;
}
```

No changes to core domain types, pipeline, MCP tools, or exporters. This is purely a storage layer refactor.

## Index File Types

Indexes are derived data — always rebuildable from individual memory files. They are updated on every write (write-through) for performance, but never the source of truth.

## Decisions

- **File-based storage** — stays true to local-first, no new dependencies.
- **Type-then-scope hierarchy** — matches how users think about memories.
- **Write-through indexes** — fast reads, slightly slower writes (acceptable trade-off).
- **One file per memory** — easy to diff, edit, version, and debug.
- **Automatic migration** — no manual steps required for existing users.
