# OpenMemBrain Architecture

OpenMemBrain Core is the product. Integrations, MCP, and static files are access layers around the core memory engine.

## Core Pipeline

```text
session transcript or summary
  -> pre-filter secrets and obvious unsafe content
  -> LLM-based memory candidate extraction
  -> rule-based validation
  -> sensitivity classification
  -> deduplication
  -> conflict detection
  -> auto-save / ask approval / reject
  -> local memory store
  -> MCP retrieval for future AI sessions
  -> optional static file export
```

## Current Package Layout

```text
apps/
  mcp-server/

packages/
  core/
  storage/
  exporters/
  shared/
```

## Package Dependency Graph

```text
@openmembrain/shared        (no internal dependencies)
       ^
       |
@openmembrain/core          (depends on shared)
       ^
       |
  +----+----+
  |         |
storage   exporters         (both depend on core)
  ^         ^
  |         |
  +----+----+
       |
  mcp-server                (imports core, storage, exporters, shared)
```

All packages are imported via path aliases: `@openmembrain/core`, `@openmembrain/storage`, `@openmembrain/exporters`, `@openmembrain/shared`.

## Package Responsibilities

`packages/core` owns:

- session ingestion
- memory extraction pipeline
- memory candidate classification
- policy checks
- redaction
- deduplication
- conflict detection
- recommendation logic
- approval and rejection logic
- diagnostics and typed errors

`packages/storage` owns:

- local memory persistence
- pending candidate persistence
- audit log persistence
- diagnostics log persistence
- JSON storage for the MVP

`apps/mcp-server` owns:

- MCP tool registration
- tool input validation
- safe user-facing error responses
- local composition of core, storage, exporters, and diagnostics

`packages/exporters` owns:

- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`
- `.cursor/rules/openmembrain.mdc`
- `docs/ai/project-memory.md`

`packages/shared` owns:

- IDs
- time helpers
- generic result types

## Extractor Boundary

LLM integration must stay behind an interface:

```ts
interface MemoryExtractor {
  extract(input: SessionInput): Promise<MemoryCandidate[]>;
}
```

Current implementation:

- `MockMemoryExtractor`

Future implementations:

- OpenAI extractor
- Anthropic extractor
- local model extractor
- enterprise/self-hosted extractor

The core must not hardwire a single LLM provider.

## Memory Candidate Schema

Each extracted candidate should include:

- `id`
- `projectId`
- `type`
- `content`
- `scope`
- `confidence`
- `sensitivity`
- `source`
- `reason`
- `recommendedAction`
- `tags`
- `createdAt`
- `updatedAt`
- `rejectionReason` (optional) — set when the candidate is rejected; describes why
- `duplicateOf` (optional) — ID of the existing memory this candidate duplicates
- `conflictWith` (optional) — IDs of existing memories this candidate conflicts with

Memory types:

- `project_fact`
- `coding_rule`
- `architecture_decision`
- `known_gotcha`
- `testing_rule`
- `deployment_rule`
- `security_rule`
- `forbidden_pattern`
- `domain_knowledge`
- `session_summary`

Recommended actions:

- `auto_save`
- `ask_user`
- `reject`

Sensitivity values:

- `public`
- `internal`
- `confidential`
- `secret`

Confidence values:

- `low`
- `medium`
- `high`

Scopes:

- `global`
- `frontend`
- `backend`
- `database`
- `deployment`
- `testing`
- `security`
- `tooling`
- `unknown`

## Memory Source

The `source` field on candidates and entries uses the `MemorySource` interface:

- `kind`: `"session"` | `"manual"` | `"import"` | `"system"`
- `sessionId` (optional): source session identifier
- `tool` (optional): AI tool or adapter name that produced the session
- `excerpt` (optional): relevant excerpt from the source session
- `transcriptHash` (optional): hash of the source transcript for deduplication

## Memory Entry

A `MemoryEntry` is the persisted form of an approved memory. While `MemoryCandidate` is the pipeline's working type (extracted, classified, recommended), `MemoryEntry` is what gets saved to the memory store after approval.

Key differences from `MemoryCandidate`:

- `sensitivity` excludes `"secret"` — secrets can never be saved
- `status`: `"active"` | `"superseded"`
- `approvedAt`: timestamp when the candidate was approved
- `supersededBy` (optional): ID of the replacement memory
- `supersededAt` (optional): timestamp when this memory was superseded
- No `recommendedAction`, `rejectionReason`, `duplicateOf`, or `conflictWith` — these are pipeline-only fields

Conversion from candidate to entry is handled by `memoryEntryFromCandidate()` in `packages/core`.

## Decision Rules

Auto-save only low-risk, high-confidence facts such as:

- detected framework
- detected test command
- clear project convention explicitly stated by the user
- obvious non-sensitive project rule

Ask approval for:

- architecture decisions
- security rules
- workflow rules
- broad coding conventions
- memory that may affect many future AI outputs
- memory that conflicts with existing memory

Reject:

- secrets
- credentials
- private keys
- raw database URLs
- raw access tokens
- unverified guesses
- temporary logs
- temporary stack traces
- large raw code blocks
- generic advice
- emotional commentary
- failed attempts without durable lessons

## Memory Approval Service

`MemoryApprovalService` in `packages/core` handles the approve/reject workflow for pending candidates.

**Approve** (`approve(projectId, candidateId)`):

1. Finds the pending candidate by ID.
2. Blocks if the candidate is classified as `secret` sensitivity.
3. Runs `SecretDetector.containsSecret()` on the content as a safety net.
4. Checks for duplicates via `Deduplicator.findDuplicate()`.
5. Converts the candidate to a `MemoryEntry` via `memoryEntryFromCandidate()`.
6. Saves the entry, removes the candidate from pending, and logs a `memory_saved` audit event.
7. If the candidate had `conflictWith` entries, supersedes those conflicting memories.

**Reject** (`reject(projectId, candidateId, reason?)`):

1. Finds the pending candidate by ID.
2. Removes the candidate and logs a `candidate_rejected` audit event.

## Memory Policy

`MemoryPolicy` in `packages/core` defines configurable thresholds for the policy engine:

- `maxContentLength`: maximum allowed content length (default: `1000`)
- `maxRawCodeBlockLength`: maximum raw code block length before rejection (default: `500`)
- `autoSaveTypes`: memory types eligible for auto-save: `project_fact`, `coding_rule`, `testing_rule`
- `askUserTypes`: memory types that require user approval: `architecture_decision`, `known_gotcha`, `deployment_rule`, `security_rule`, `forbidden_pattern`, `domain_knowledge`, `session_summary`

The `PolicyEngine` combines `SecretDetector`, `NoiseFilter`, and `SafetyFilter` to produce a `PolicyCheck` with `allowed`, `sensitivity`, and `violations` fields.

## Audit And Diagnostic Schemas

Audit event types:

- `session_ingested`
- `candidate_extracted`
- `memory_saved`
- `candidate_queued`
- `candidate_rejected`
- `memory_superseded`
- `memory_updated`

Each `AuditEvent` includes `id`, `projectId`, `type`, `entityId` (optional), `createdAt`, and `details` (optional).

Diagnostic severity values:

- `debug`
- `info`
- `warning`
- `error`

Each `DiagnosticEvent` includes `id`, `projectId`, `severity`, `code`, `message`, `operation` (optional), `source` (optional: `"core"` | `"storage"` | `"mcp-server"` | `"exporter"` | `"adapter"`), `entityId` (optional), `createdAt`, and `details` (optional).

## MCP Tool Surface

Current tools:

- `propose_memory_from_session`
- `get_project_rules`
- `get_relevant_context`
- `search_memory`
- `list_memory_candidates`
- `approve_memory_candidate`
- `reject_memory_candidate`
- `export_static_memory_files`
- `get_diagnostics`
- `list_audit_log`
- `update_memory`
- `supersede_memory`
- `review_stale_memories`

MCP is the main tool-facing access layer for the MVP, but it is not the entire product.

## Static Fallback Files

Static files exist for compatibility with tools that cannot use MCP. They are fallback outputs, not the main workflow.

Exporters exclude `confidential` memory by default because generated instruction files may be committed to source control.

## Future Adapters

Adapters should be thin and tool-specific:

- Codex adapter
- OpenCode plugin
- VS Code extension
- Cursor integration
- Claude Code integration

Adapters should collect session summaries or transcripts and send them to OpenMemBrain Core. They should not contain memory policy logic.
