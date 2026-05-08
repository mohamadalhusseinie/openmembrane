# OpenMembrain

OpenMembrain is a local-first, private, tool-agnostic memory layer for AI coding tools.

## MVP Architecture

The first implementation is centered on the autonomous memory pipeline, not a CLI workflow.

```text
session transcript or summary
  -> SessionIngestor
  -> SecretDetector redaction
  -> MemoryExtractor interface
  -> MockMemoryExtractor
  -> MemoryClassifier
  -> PolicyEngine / SafetyFilter / NoiseFilter
  -> Deduplicator
  -> ConflictDetector
  -> ActionRecommender
  -> MemoryStore or PendingCandidateStore
```

Package responsibilities:

- `packages/core`: domain types, extraction interface, policy checks, classification, deduplication, conflict detection, and pipeline orchestration.
- `packages/storage`: local JSON persistence for saved memory, pending approvals, and audit events.
- `packages/exporters`: static fallback file generation for AI tools that read project instruction files.
- `packages/shared`: small runtime helpers for IDs, time, and result types.
- `apps/mcp-server`: local MCP server exposing saved memory and approval workflows to AI tools.

Provider-specific LLM calls are intentionally kept out of the core. The boundary is:

```ts
interface MemoryExtractor {
  extract(input: SessionInput): Promise<MemoryCandidate[]>;
}
```

The MVP ships with `MockMemoryExtractor` so the pipeline can be tested deterministically before adding OpenAI, Anthropic, or local model extractors.

## Local MCP Server

Run the MCP server over stdio:

```powershell
npm run mcp:stdio
```

By default, local memory is stored in `.openmembrain` under the current working directory. Override this with:

- `OPENMEMBRAIN_HOME`: directory for local JSON memory stores.
- `OPENMEMBRAIN_PROJECT_ID`: default project id when a tool call does not pass `projectId`.

Initial MCP tools:

- `propose_memory_from_session`
- `get_project_rules`
- `get_relevant_context`
- `search_memory`
- `list_memory_candidates`
- `approve_memory_candidate`
- `reject_memory_candidate`
- `export_static_memory_files`

## Static Fallback Files

Static exporters can generate:

- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`
- `.cursor/rules/openmembrain.mdc`
- `docs/ai/project-memory.md`

These files are compatibility fallbacks for tools that cannot retrieve memory through MCP. By default, exporters omit `confidential` memories because these files may be committed to source control. Callers must explicitly opt in to include confidential memory.
