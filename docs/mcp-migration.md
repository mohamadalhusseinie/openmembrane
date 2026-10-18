# MCP thin-client migration

MCP now registers exactly seven mid-session tools: `remember`,
`get_project_rules`, `get_relevant_context`, `search_memory`,
`list_memory_candidates`, `approve_memory_candidate`, and
`reject_memory_candidate`. Restart your AI host after upgrading so it refreshes
tool discovery, and remove references to the old tools from custom instructions.
Generated instruction files and the setup examples use only retained tools.

The first tool call auto-starts the per-user daemon if it is not running.
Tool discovery is lazy and does not open stores or launch a daemon. Later calls,
other MCP sessions, CLI commands, and the review UI share the same daemon.
Closing an MCP session does not stop it; use `openmembrane stop` when appropriate.
CLI commands and the review UI still require a running daemon; use
`openmembrane start` before using them independently.

## Removed tools and replacements

Run CLI commands from the project directory; `--project <id>` overrides the
project ID. All data commands support `--output text|json|markdown`. The daemon
endpoints remain available; no maintenance operation was removed from the product.

| Removed MCP tool | CLI replacement | Review UI equivalent |
| --- | --- | --- |
| `propose_memory_from_session` | `openmembrane ingest --file session.txt` or `--stdin` | CLI/daemon only |
| `approve_all_candidates` | `openmembrane candidates approve-all` | Candidates: approve all |
| `reject_all_candidates` | `openmembrane candidates reject-all` | Candidates: reject all |
| `update_memory` | `openmembrane memory update <id> --content "Updated rule"` | Memory editor |
| `supersede_memory` | `openmembrane memory supersede <id>` | Memory: supersede |
| `review_stale_memories` | `openmembrane memory stale` | Stale-memory review |
| `export_static_memory_files` | `openmembrane export` (or `--preview`) | Export preview/write |
| `get_diagnostics` | `openmembrane diagnostics` | Diagnostics |
| `list_audit_log` | `openmembrane audit` | Audit |
| `configure_github_team_mode` | `openmembrane team configure --owner <owner> --repo <private-repo>` | CLI/daemon only |
| `get_collaboration_status` | `openmembrane team status` | CLI/daemon only |

Extraction providers and their credentials belong to the daemon's environment.
Configure them before starting the daemon; an existing daemon does not adopt
credentials from subsequent MCP sessions. `remember` still needs no extractor
or API key.

## Errors and session reminders

MCP keeps its `{ error: { code, message, diagnosticId } }` envelope and session
nudge tracker. Daemon errors preserve their diagnostic IDs and safe messages;
the daemon owns diagnostic persistence and GitHub publication retries.
Client/startup failures receive an ID correlated on MCP stderr, without writing
protocol noise to stdout or opening local stores. Inspect project diagnostics
using the CLI/UI and daemon failures in the local daemon log.

MCP uses a 30-minute request deadline to allow GitHub Team operations to finish.
A timeout does not cancel daemon processing or prove that nothing was saved.
Inspect project memory and audit history before retrying a mutation.
