# OpenMembrane Roadmap

This roadmap keeps the product centered on the local autonomous memory engine before adding hosted, team, or enterprise features.

## Phase 1: Local Autonomous Memory MVP

Status: complete (v0.1.0).

Implemented:

- TypeScript monorepo
- core memory pipeline
- `remember` tool (primary path — AI-side extraction, no server LLM needed)
- `propose_memory_from_session` (secondary path — server-side LLM extraction)
- deterministic mock extractor (for testing)
- LLM-backed extractor behind `MemoryExtractor` interface
- extraction prompt design with chunking and response parsing
- rule-based secret detection
- noise and safety filters
- action recommendation
- deduplication
- conflict detection with improved heuristics
- JSON local memory store
- SQLite storage backend (better-sqlite3)
- pending approval queue
- audit log
- diagnostics log
- transport-agnostic ingestion API for adapters
- multi-signal relevance scoring
- MCP server with 16 tools
- static fallback exporters (AGENTS.md, CLAUDE.md, copilot-instructions.md, cursor rules, project-memory.md)
- test suite (34 test files, cross-platform CI)
- Changesets release workflow

## Phase 2: Real Extraction With Explicit Policy

Status: complete (delivered as part of Phase 1).

The `LlmMemoryExtractor` is implemented behind the `MemoryExtractor` interface. Secrets are redacted before model calls. `MockMemoryExtractor` is preserved for deterministic tests. Provider configuration is explicit and required.

## Phase 3: Local Ingestion API

Status: complete (delivered as part of Phase 1).

The `IngestionService` provides a transport-agnostic ingestion API. It accepts session summaries/transcripts, returns candidate/save/pending/reject results, logs diagnostics, supports project identification, and keeps raw conversation storage off by default.

## Phase 4: First Tool Adapter

Build one thin adapter before attempting broad integration.

Candidate first adapters:

- Codex adapter
- OpenCode plugin

Adapter responsibilities:

- detect current project
- collect session summary/transcript if available
- send data to local OpenMembrane
- retrieve relevant memory for new sessions
- never own memory policy

## Phase 5: Retrieval Quality

Improve retrieval after the MVP loop works end to end.

Initial relevance scoring (multi-signal `RelevanceScorer`) is implemented. Possible further improvements:

- better token ranking
- scope and type weighting
- recency weighting
- project-specific tags
- optional local embeddings
- conflict-aware context rendering

## Phase 6: Local Developer UX

Status: complete (local review UI is available).

Implemented:

- local review UI for inspecting memories and pending candidates
- pending candidate approval and rejection view
- memory search view
- audit and diagnostics view

## Phase 7: GitHub Team

Status: current initial release. GitHub.com is tested; the host-agnostic `gh`
integration does not formally support GitHub Enterprise Server yet.

Implemented:

- manually selected dedicated private repository per project
- user-owned `gh` authentication
- one pull request per accepted memory
- accepted-memory-only sync
- no pending candidates, raw transcripts, source excerpts, diagnostics, or credentials in the repository

Shared memory becomes retrievable only after its pull request merges to the
repository's default branch, which is authoritative.

See [Deployment Modes](deployment-modes.md#github-team) for the canonical
ownership and boundary description.

## Phase 8: Self-Hosted Team

Planned mode.

Goals:

- run inside company infrastructure
- self-managed storage
- company-controlled model providers
- policy controls
- audit logs
- tenant isolation for internal teams

## Phase 9: Managed Team

Planned mode.

Goals:

- accounts
- teams
- billing
- managed shared memory
- organization policies
- admin controls
- audit exports
- tenant isolation
- encryption controls

Managed Team must not undermine Local Private's default behavior. See
[Deployment Modes](deployment-modes.md) for the canonical product-mode
definitions and residency language.
