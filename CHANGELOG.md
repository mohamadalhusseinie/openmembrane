# Changelog

All notable changes to OpenMemBrain will be documented in this file.

This changelog is now managed by [Changesets](https://github.com/changesets/changesets). See [docs/release.md](docs/release.md) for the release process.

## [Unreleased]

### Added

- Core memory pipeline: ingestion, extraction, classification, policy checks, deduplication, conflict detection, and action recommendation.
- MCP server with 13 tools: `propose_memory_from_session`, `get_project_rules`, `get_relevant_context`, `search_memory`, `list_memory_candidates`, `approve_memory_candidate`, `reject_memory_candidate`, `update_memory`, `supersede_memory`, `review_stale_memories`, `export_static_memory_files`, `get_diagnostics`, `list_audit_log`.
- Local JSON persistence for memories, pending candidates, audit events, and diagnostics.
- Static fallback exporters for AGENTS.md, CLAUDE.md, copilot-instructions.md, Cursor rules, and project-memory.md.
- Rule-based secret detection and redaction.
- Noise and safety filters.
- Mock memory extractor for deterministic testing.
- npm package distribution (`npx openmembrain`).
