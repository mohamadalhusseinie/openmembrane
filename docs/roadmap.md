# OpenMemBrain Roadmap

This roadmap keeps the product centered on the local autonomous memory engine before adding hosted, team, or enterprise features.

## Phase 1: Local Autonomous Memory MVP

Status: complete (v0.1.0).

Implemented:

- TypeScript monorepo
- core memory pipeline
- deterministic mock extractor
- OpenAI-backed extractor behind `MemoryExtractor` interface
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
- MCP server with 13 tools
- static fallback exporters (AGENTS.md, CLAUDE.md, copilot-instructions.md, cursor rules, project-memory.md)
- test suite (34 test files, cross-platform CI)
- Changesets release workflow

## Phase 2: Real Extraction With Explicit Policy

Status: complete (delivered as part of Phase 1).

The `OpenAiMemoryExtractor` is implemented behind the `MemoryExtractor` interface. Secrets are redacted before model calls. `MockMemoryExtractor` is preserved for deterministic tests. Provider configuration is explicit and required.

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
- send data to local OpenMemBrain
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

Add inspectability without turning the product into a CLI-first tool.

Possible features:

- simple local review UI
- pending candidate approval view
- memory search view
- audit and diagnostics view
- static export preview

## Phase 7: CH/EU Sync Mode

Future mode, not MVP.

Goals:

- encrypted memory sync
- CH/EU-hosted infrastructure
- explicit user/team opt-in
- clear policy for external LLM usage
- no raw full conversation sync by default

## Phase 8: Self-Hosted Mode

Future enterprise mode.

Goals:

- run inside company infrastructure
- self-managed storage
- company-controlled model providers
- policy controls
- audit logs
- tenant isolation for internal teams

## Phase 9: Hosted Team Mode

Future managed mode.

Goals:

- accounts
- teams
- billing
- hosted sync
- organization policies
- admin controls
- audit exports
- tenant isolation
- encryption controls

Hosted mode must not undermine the local-first positioning. Local-only mode remains a first-class mode.
