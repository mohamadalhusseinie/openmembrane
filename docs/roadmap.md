# OpenMembrain Roadmap

This roadmap keeps the product centered on the local autonomous memory engine before adding hosted, team, or enterprise features.

## Phase 1: Local Autonomous Memory MVP

Status: in progress.

Implemented:

- TypeScript monorepo
- core memory pipeline
- deterministic mock extractor
- rule-based secret detection
- noise and safety filters
- action recommendation
- deduplication
- conflict detection
- JSON local memory store
- pending approval queue
- audit log
- diagnostics log
- MCP server
- static fallback exporters
- test suite

Remaining:

- real LLM extractor behind `MemoryExtractor`
- local ingestion API for adapters
- stronger relevance ranking
- better conflict detection
- more test coverage around edge cases

## Phase 2: Real Extraction With Explicit Policy

Add provider-backed extraction without compromising local-first defaults.

Goals:

- add `OpenAiMemoryExtractor` behind `MemoryExtractor`
- support Anthropic/local extractors later
- require explicit configuration before external LLM usage
- do not persist raw full conversations by default
- redact secrets before model calls
- log diagnostics for provider failures
- preserve `MockMemoryExtractor` for deterministic tests

Non-goals:

- no provider lock-in
- no automatic external model calls without configuration
- no cloud sync

## Phase 3: Local Ingestion API

Add a local API so adapters can submit session summaries or transcripts without treating the CLI as the product.

Possible options:

- local HTTP endpoint
- filesystem drop folder
- MCP-only ingestion for early adapters

Requirements:

- accepts session summaries/transcripts
- returns candidate/save/pending/reject results
- logs diagnostics
- supports project identification
- keeps raw conversation storage off by default

## Phase 4: First Tool Adapter

Build one thin adapter before attempting broad integration.

Candidate first adapters:

- Codex adapter
- OpenCode plugin

Adapter responsibilities:

- detect current project
- collect session summary/transcript if available
- send data to local OpenMembrain
- retrieve relevant memory for new sessions
- never own memory policy

## Phase 5: Retrieval Quality

Improve retrieval after the MVP loop works end to end.

Possible improvements:

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
