---
"openmembrain": major
---

Improve pending candidate review UX:

- **BREAKING:** `get_project_rules` now returns `{ rules, pendingCandidateCount }` instead of `MemoryEntry[]`. `get_relevant_context` now returns `{ memories, pendingCandidateCount }` instead of the array directly.
- New `approve_all_candidates` and `reject_all_candidates` MCP tools for batch operations.
- CLI `ingest` and `context` commands print a reminder to stderr when pending candidates exist.
