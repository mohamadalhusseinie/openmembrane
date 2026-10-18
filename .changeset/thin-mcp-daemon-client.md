---
"openmembrane": major
---

Make MCP a thin authenticated daemon client and reduce its surface to seven
mid-session tools. The first tool call auto-starts the daemon if needed; later
calls and MCP sessions reuse it. Tool discovery does not start the daemon.
Safe error envelopes, daemon diagnostic IDs, and session nudges are preserved.

Breaking: the following MCP tools are removed. Their daemon endpoints remain,
and all operations have CLI replacements shipping with this change:

| Removed MCP tool | Replacement |
| --- | --- |
| `propose_memory_from_session` | `openmembrane ingest --file session.txt` or `--stdin` |
| `approve_all_candidates` | `openmembrane candidates approve-all`; review UI bulk approval |
| `reject_all_candidates` | `openmembrane candidates reject-all`; review UI bulk rejection |
| `update_memory` | `openmembrane memory update <id>`; review UI memory editor |
| `supersede_memory` | `openmembrane memory supersede <id>`; review UI supersession |
| `review_stale_memories` | `openmembrane memory stale`; review UI stale-memory review |
| `export_static_memory_files` | `openmembrane export`; review UI export preview/write |
| `get_diagnostics` | `openmembrane diagnostics`; review UI diagnostics |
| `list_audit_log` | `openmembrane audit`; review UI audit |
| `configure_github_team_mode` | `openmembrane team configure --owner <owner> --repo <private-repo>` |
| `get_collaboration_status` | `openmembrane team status` |

Restart AI hosts after upgrading and update custom instructions to use only
`remember`, `get_project_rules`, `get_relevant_context`, `search_memory`,
`list_memory_candidates`, `approve_memory_candidate`, and
`reject_memory_candidate`. Configure extraction providers in the daemon's
environment, not through transcript-ingestion MCP calls.
