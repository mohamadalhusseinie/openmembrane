# openmembrane

## 2.0.0

### Major Changes

- f890b5f: Rename the project, package, CLI, environment variables, MCP tools, and default storage paths to the new OpenMembrane/openmembrane name.
- b76a051: Make MCP a thin authenticated daemon client and reduce its surface to seven
  mid-session tools. The first tool call auto-starts the daemon if needed; later
  calls and MCP sessions reuse it. Tool discovery does not start the daemon.
  Safe error envelopes, daemon diagnostic IDs, and session nudges are preserved.
  Readiness polling tolerates the daemon's transient starting state. Project
  failures are persisted by the daemon using the returned diagnostic ID and are
  available through CLI/UI diagnostics.

  Breaking: the following MCP tools are removed. Their daemon endpoints remain,
  and all operations have CLI replacements shipping with this change:

  | Removed MCP tool              | Replacement                                                         |
  | ----------------------------- | ------------------------------------------------------------------- |
  | `propose_memory_from_session` | `openmembrane ingest --file session.txt` or `--stdin`               |
  | `approve_all_candidates`      | `openmembrane candidates approve-all`; review UI bulk approval      |
  | `reject_all_candidates`       | `openmembrane candidates reject-all`; review UI bulk rejection      |
  | `update_memory`               | `openmembrane memory update <id>`; review UI memory editor          |
  | `supersede_memory`            | `openmembrane memory supersede <id>`; review UI supersession        |
  | `review_stale_memories`       | `openmembrane memory stale`; review UI stale-memory review          |
  | `export_static_memory_files`  | `openmembrane export`; review UI export preview/write               |
  | `get_diagnostics`             | `openmembrane diagnostics`; review UI diagnostics                   |
  | `list_audit_log`              | `openmembrane audit`; review UI audit                               |
  | `configure_github_team_mode`  | `openmembrane team configure --owner <owner> --repo <private-repo>` |
  | `get_collaboration_status`    | `openmembrane team status`                                          |

  Restart AI hosts after upgrading and update custom instructions to use only
  `remember`, `get_project_rules`, `get_relevant_context`, `search_memory`,
  `list_memory_candidates`, `approve_memory_candidate`, and
  `reject_memory_candidate`. Configure extraction providers in the daemon's
  environment, not through transcript-ingestion MCP calls.

### Minor Changes

- 5df7114: Add local developer review UI for inspecting memories, approving/rejecting candidates, and viewing audit/diagnostics history. Launch with `npm run review-ui` or `tsx apps/review-ui/src/index.ts`.
- ffceec8: Auto-enable AI extractor when API key environment variable is present. Previously, users had to set both `OPENMEMBRANE_EXTRACTION_ENABLED=true` and `OPENMEMBRANE_EXTRACTION_PROVIDER=openai` alongside the API key. Now, the presence of an API key alone is sufficient to enable the real extractor. Explicit `ENABLED=false` still overrides. A startup diagnostic is logged when falling back to mock extraction.
- 74b05b6: Add a Claude Code hooks installer with automatic session ingestion, optional per-turn capture, and reversible retrieval instructions.
- 20fe898: Add a Codex adapter with automatic SessionEnd capture, reversible hook installation, and startup retrieval instructions.
- f843c18: Add an internal versioned daemon protocol and authenticated local client with shared endpoint resolution, caller project context, and opt-in detached auto-launch.
- 1dbabec: Add GitHub Team mode with private repository-backed, pull-request-reviewed project memory.
- 8b21bc2: Add an authenticated per-user local daemon with Unix sockets or Windows loopback TCP, isolated project stores, safe GitHub Team handling, and serve/start/status/stop lifecycle commands. Preserve existing no-argument MCP stdio and add an explicit mcp command.

  MCP configurations that previously passed `serve` must switch to `mcp` or omit arguments. Canonical storage paths protect shared indexes across filesystem aliases, and detached startup recovers malformed stale locks.

  Daemon startup and GitHub subprocesses exclude inherited GitHub credential variables, using stored `gh` authentication instead. Listener failures throughout startup publication produce safe diagnostics and clean up discovery before failing.

  Release the daemon lock and close initialized resources when service or server construction fails, so retries in a still-running host are not blocked by abandoned ownership.

  Use a fixed timezone for POSIX process identity and normalize project roots before deriving default IDs, preventing timezone-dependent lock takeover and inconsistent memory visibility across dot-segment path spellings.

  Normalize storage dot segments before canonicalizing daemon queue keys, keeping symlink-parent path spellings serialized with writes to the same service store.

  Continue listener shutdown, request draining, store closure, and lock release when recovery-guard creation fails, without deleting unprotected shared discovery files.

  Treat unreaped Linux zombie and dead processes as exited when verifying lock and recovery-guard ownership, allowing a replacement daemon to recover their stale files.

  Require fully qualified Windows drive or UNC paths in daemon requests, rejecting rooted paths that would otherwise select the daemon's current drive.

- 2ff566d: add remember tool for direct AI-side memory extraction
- 3962ed0: Add the OpenCode reference plugin for automatic session ingestion and explicitly opted-in project memory injection through the local daemon. Persist indexed session-content decisions so automatic replay respects rejections and does not restore superseded memories.
- 52eafe5: Refactor extractor-openai into provider-agnostic extractor-llm for any OpenAI-compatible endpoint.

  - Rename `@openmembrane/extractor-openai` to `@openmembrane/extractor-llm`
  - Rename `OpenAiMemoryExtractor` to `LlmMemoryExtractor`
  - Make `apiKey` optional for local models (Ollama, LM Studio, vLLM)
  - Add `jsonMode` config flag to conditionally send `response_format`
  - Add JSON extraction from freeform responses (markdown fences, surrounding text)
  - Update provider list to `[mock, llm, anthropic]`
  - Remove `OPENMEMBRANE_OPENAI_*` env var fallbacks
  - Add `OPENMEMBRANE_EXTRACTION_JSON_MODE` env var support

- a162b13: Move CLI ingestion, context retrieval, and the review UI to the authenticated local daemon. Add candidate management, memory updates and stale review, export and preview, diagnostics, audit, and GitHub Team configuration/status commands with text, JSON, and Markdown output. Start the daemon with `openmembrane start` before using these client surfaces.
- 6046099: Add a VS Code extension with automatic daemon startup and MCP registration,
  an @openmembrane chat participant, candidate review, static exports, diagnostics,
  explicit chat export capture, and opt-in participant auto-save.

### Patch Changes

- 91db8ff: Document daemon architecture, per-tool adapter setup, and the single-writer storage rule.
- 0a59063: Add design docs for CH/EU encrypted sync mode and the GDPR/DSGVO/Swiss nDSG/EU AI Act compliance framework (docs/design/ch-eu-sync-mode.md, docs/design/compliance-framework.md). Design-only, no implementation.
- dd567a7: Update all documentation to reflect remember-first architecture. The `remember` tool is now presented as the primary interface for saving memory (no API key needed), with `propose_memory_from_session` documented as the secondary automation path.
- 6309b35: Extract in-process service facade; no behavior change.
- f969488: Document the planned local-first Knowledge Graph, including relationship modeling, privacy boundaries, and Review UI delivery stages.
- 2936c08: Update OpenCode and extraction documentation to reflect the current LLM extractor configuration.
- 0e3b586: Rank all eligible approved memories before limiting retrieval results so older relevant rules remain discoverable.
- 8bf9734: Update exported static memory guidance to use the remember-first save flow and explicit user-triggered saves.

## 1.0.2

### Patch Changes

- acb036e: Fix startup crash ("Dynamic require of fs is not supported") by lazy-loading the SQLite storage backend. The better-sqlite3 native module is now only imported when OPENMEMBRANE_STORAGE_BACKEND=sqlite is explicitly set, and is marked as an external optional dependency.

## 1.0.1

### Patch Changes

- 4a5cd3e: Submit OpenMembrane to MCP directories and curated lists for discoverability.

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
