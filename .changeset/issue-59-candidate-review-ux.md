---
"openmembrain": minor
---

Improve pending candidate review UX:

- `get_project_rules` and `get_relevant_context` now return an object with a `pendingCandidateCount` field alongside the results (`rules` and `memories` keys respectively).
- New `approve_all_candidates` and `reject_all_candidates` MCP tools for batch operations.
- CLI `ingest` and `context` commands print a reminder to stderr when pending candidates exist.
