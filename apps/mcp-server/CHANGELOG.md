# openmembrain

## 1.0.0

### Major Changes

- 062b2c3: Improve pending candidate review UX:

  - **BREAKING:** `get_project_rules` now returns `{ rules, pendingCandidateCount }` instead of `MemoryEntry[]`. `get_relevant_context` now returns `{ memories, pendingCandidateCount }` instead of the array directly.
  - New `approve_all_candidates` and `reject_all_candidates` MCP tools for batch operations.
  - CLI `ingest` and `context` commands print a reminder to stderr when pending candidates exist.

### Minor Changes

- 9a5978d: Add usage instructions preamble to exported static memory files and document global instruction file pattern across all platform setup guides.

### Patch Changes

- daae47a: Refactor memory workflow from session-end to proactive in-session behavior.

  All instructions, docs, and exported preambles now tell AI tools to call
  `propose_memory_from_session` immediately when durable knowledge is discovered
  rather than deferring to a session-end signal that may never arrive. Session
  start instructions now include `list_memory_candidates` to surface pending
  candidates for developer review.
