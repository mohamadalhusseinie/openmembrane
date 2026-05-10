# OpenMembrain

OpenMembrain is a local-first, private, tool-agnostic memory layer for AI coding tools.

## Installation

Install and run the MCP server with npx (requires Node.js >= 18):

```sh
npx openmembrain
```

Or install globally:

```sh
npm install -g openmembrain
openmembrain
```

No cloud accounts required. All memory is stored locally.

## Configuring Your AI Tool

OpenMembrain runs as an MCP server over stdio. Add it to your AI tool's MCP configuration:

### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "openmembrain": {
      "command": "npx",
      "args": ["openmembrain"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add openmembrain -- npx openmembrain
```

### VS Code / GitHub Copilot

Add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "openmembrain": {
      "command": "npx",
      "args": ["openmembrain"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "openmembrain": {
      "command": "npx",
      "args": ["openmembrain"]
    }
  }
}
```

## Environment Variables

By default, local memory is stored in `.openmembrain` under the current working directory. Override this with:

- `OPENMEMBRAIN_HOME`: directory for local JSON memory stores.
- `OPENMEMBRAIN_PROJECT_ID`: default project id when a tool call does not pass `projectId`.

## MCP Tools

- `propose_memory_from_session`
- `get_project_rules`
- `get_relevant_context`
- `search_memory`
- `list_memory_candidates`
- `approve_memory_candidate`
- `reject_memory_candidate`
- `update_memory`
- `supersede_memory`
- `review_stale_memories`
- `export_static_memory_files`
- `get_diagnostics`
- `list_audit_log`

## Architecture

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

## Diagnostics And Errors

OpenMembrain distinguishes audit history from diagnostics:

- Audit events describe normal memory activity, such as session ingestion, candidate extraction, saved memory, queued candidates, and rejected candidates.
- Diagnostics describe operational problems, such as validation errors, missing candidates, invalid local JSON stores, unsafe approval attempts, and export failures.

MCP tools return safe user-facing error payloads with a `diagnosticId`. The detailed diagnostic can be inspected through `get_diagnostics` without exposing raw transcripts or secrets.

## Static Fallback Files

Static exporters can generate:

- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`
- `.cursor/rules/openmembrain.mdc`
- `docs/ai/project-memory.md`

These files are compatibility fallbacks for tools that cannot retrieve memory through MCP. By default, exporters omit `confidential` memories because these files may be committed to source control. Callers must explicitly opt in to include confidential memory.

## Development

```sh
git clone https://github.com/mohamadalhusseinie/openmembrain.git
cd openmembrain
npm install
```

Run the MCP server locally (from source via tsx):

```sh
npm run mcp:stdio
```

Run tests and type checking:

```sh
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run check     # both
```

Build the publishable bundle:

```sh
npm run build
```
