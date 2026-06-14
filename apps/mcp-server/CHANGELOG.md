# openmembrane

## 2.0.0

### Major Changes

- f890b5f: Rename the project, package, CLI, environment variables, MCP tools, and default storage paths to the new OpenMembrane/openmembrane name.

### Minor Changes

- 5df7114: Add local developer review UI for inspecting memories, approving/rejecting candidates, and viewing audit/diagnostics history. Launch with `npm run review-ui` or `tsx apps/review-ui/src/index.ts`.
- ffceec8: Auto-enable AI extractor when API key environment variable is present. Previously, users had to set both `OPENMEMBRANE_EXTRACTION_ENABLED=true` and `OPENMEMBRANE_EXTRACTION_PROVIDER=openai` alongside the API key. Now, the presence of an API key alone is sufficient to enable the real extractor. Explicit `ENABLED=false` still overrides. A startup diagnostic is logged when falling back to mock extraction.
- 2ff566d: add remember tool for direct AI-side memory extraction
- 52eafe5: Refactor extractor-openai into provider-agnostic extractor-llm for any OpenAI-compatible endpoint.

  - Rename `@openmembrane/extractor-openai` to `@openmembrane/extractor-llm`
  - Rename `OpenAiMemoryExtractor` to `LlmMemoryExtractor`
  - Make `apiKey` optional for local models (Ollama, LM Studio, vLLM)
  - Add `jsonMode` config flag to conditionally send `response_format`
  - Add JSON extraction from freeform responses (markdown fences, surrounding text)
  - Update provider list to `[mock, llm, anthropic]`
  - Remove `OPENMEMBRANE_OPENAI_*` env var fallbacks
  - Add `OPENMEMBRANE_EXTRACTION_JSON_MODE` env var support

### Patch Changes

- dd567a7: Update all documentation to reflect remember-first architecture. The `remember` tool is now presented as the primary interface for saving memory (no API key needed), with `propose_memory_from_session` documented as the secondary automation path.
- 2936c08: Update OpenCode and extraction documentation to reflect the current LLM extractor configuration.
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
