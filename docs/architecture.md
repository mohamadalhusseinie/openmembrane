# OpenMembrain Architecture

OpenMembrain Core is the product. Integrations, MCP, and static files are access layers around the core memory engine.

## Core Pipeline

```text
session transcript or summary
  -> pre-filter secrets and obvious unsafe content
  -> LLM-based memory candidate extraction
  -> rule-based validation
  -> sensitivity classification
  -> deduplication
  -> conflict detection
  -> auto-save / ask approval / reject
  -> local memory store
  -> MCP retrieval for future AI sessions
  -> optional static file export
```

## Current Package Layout

```text
apps/
  mcp-server/

packages/
  core/
  storage/
  exporters/
  shared/
```

## Package Responsibilities

`packages/core` owns:

- session ingestion
- memory extraction pipeline
- memory candidate classification
- policy checks
- redaction
- deduplication
- conflict detection
- recommendation logic
- approval and rejection logic
- diagnostics and typed errors

`packages/storage` owns:

- local memory persistence
- pending candidate persistence
- audit log persistence
- diagnostics log persistence
- JSON storage for the MVP

`apps/mcp-server` owns:

- MCP tool registration
- tool input validation
- safe user-facing error responses
- local composition of core, storage, exporters, and diagnostics

`packages/exporters` owns:

- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`
- `.cursor/rules/openmembrain.mdc`
- `docs/ai/project-memory.md`

`packages/shared` owns:

- IDs
- time helpers
- generic result types

## Extractor Boundary

LLM integration must stay behind an interface:

```ts
interface MemoryExtractor {
  extract(input: SessionInput): Promise<MemoryCandidate[]>;
}
```

Current implementation:

- `MockMemoryExtractor`

Future implementations:

- OpenAI extractor
- Anthropic extractor
- local model extractor
- enterprise/self-hosted extractor

The core must not hardwire a single LLM provider.

## Memory Candidate Schema

Each extracted candidate should include:

- `id`
- `projectId`
- `type`
- `content`
- `scope`
- `confidence`
- `sensitivity`
- `source`
- `reason`
- `recommendedAction`
- `tags`
- `createdAt`
- `updatedAt`

Memory types:

- `project_fact`
- `coding_rule`
- `architecture_decision`
- `known_gotcha`
- `testing_rule`
- `deployment_rule`
- `security_rule`
- `forbidden_pattern`
- `domain_knowledge`
- `session_summary`

Recommended actions:

- `auto_save`
- `ask_user`
- `reject`

Sensitivity values:

- `public`
- `internal`
- `confidential`
- `secret`

Confidence values:

- `low`
- `medium`
- `high`

Scopes:

- `global`
- `frontend`
- `backend`
- `database`
- `deployment`
- `testing`
- `security`
- `tooling`
- `unknown`

## Decision Rules

Auto-save only low-risk, high-confidence facts such as:

- detected framework
- detected test command
- clear project convention explicitly stated by the user
- obvious non-sensitive project rule

Ask approval for:

- architecture decisions
- security rules
- workflow rules
- broad coding conventions
- memory that may affect many future AI outputs
- memory that conflicts with existing memory

Reject:

- secrets
- credentials
- private keys
- raw database URLs
- raw access tokens
- unverified guesses
- temporary logs
- temporary stack traces
- large raw code blocks
- generic advice
- emotional commentary
- failed attempts without durable lessons

## MCP Tool Surface

Current tools:

- `propose_memory_from_session`
- `get_project_rules`
- `get_relevant_context`
- `search_memory`
- `list_memory_candidates`
- `approve_memory_candidate`
- `reject_memory_candidate`
- `export_static_memory_files`
- `get_diagnostics`
- `list_audit_log`

MCP is the main tool-facing access layer for the MVP, but it is not the entire product.

## Static Fallback Files

Static files exist for compatibility with tools that cannot use MCP. They are fallback outputs, not the main workflow.

Exporters exclude `confidential` memory by default because generated instruction files may be committed to source control.

## Future Adapters

Adapters should be thin and tool-specific:

- Codex adapter
- OpenCode plugin
- VS Code extension
- Cursor integration
- Claude Code integration

Adapters should collect session summaries or transcripts and send them to OpenMembrain Core. They should not contain memory policy logic.
