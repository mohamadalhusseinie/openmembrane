---
"openmembrain": patch
---

Refactor memory workflow from session-end to proactive in-session behavior.

All instructions, docs, and exported preambles now tell AI tools to call
`propose_memory_from_session` immediately when durable knowledge is discovered
rather than deferring to a session-end signal that may never arrive. Session
start instructions now include `list_memory_candidates` to surface pending
candidates for developer review.
