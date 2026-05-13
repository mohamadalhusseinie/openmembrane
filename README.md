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

### OpenCode

**Automated (recommended):** Tell OpenCode:

> Fetch and follow instructions from https://raw.githubusercontent.com/mohamadalhusseinie/openmembrain/refs/heads/main/.opencode/INSTALL.md

**Manual:** Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "openmembrain": {
      "type": "local",
      "command": ["npx", "-y", "openmembrain"]
    }
  }
}
```

## Environment Variables

By default, local memory is stored in `.openmembrain` under the current working directory. Override this with:

- `OPENMEMBRAIN_HOME`: directory for local JSON memory stores.
- `OPENMEMBRAIN_PROJECT_ID`: default project id when a tool call does not pass `projectId`.

## MCP Tools

- `propose_memory_from_session` — submit a session transcript or summary for memory extraction. Accepts optional `metadata` (key-value pairs) for additional context.
- `get_project_rules` — retrieve project rules and conventions for the current scope.
- `get_relevant_context` — find memories relevant to a natural language query.
- `search_memory` — search saved memories by query, scope, type, or tags.
- `list_memory_candidates` — list pending memory candidates awaiting approval.
- `approve_memory_candidate` — approve a pending candidate to save it as memory.
- `reject_memory_candidate` — reject a pending candidate with an optional reason.
- `update_memory` — update the content, type, scope, or tags of a saved memory.
- `supersede_memory` — mark a memory as superseded, optionally linking a replacement.
- `review_stale_memories` — list memories older than a threshold (default: 6 months).
- `export_static_memory_files` — generate static instruction files (AGENTS.md, CLAUDE.md, etc.).
- `get_diagnostics` — retrieve diagnostic events filtered by severity or code.
- `list_audit_log` — retrieve recent audit events.

## Architecture

The first implementation is centered on the autonomous memory pipeline, not a CLI workflow.

```text
session transcript or summary
  -> SessionIngestor
  -> SecretDetector redaction (pre-extraction)
  -> MemoryExtractor interface (MockMemoryExtractor for MVP)
  -> MemoryClassifier (+ SecretDetector check)
  -> PolicyEngine (SecretDetector + SafetyFilter + NoiseFilter)
  -> Deduplicator
  -> ConflictDetector
  -> ActionRecommender
  -> MemoryApprovalService (+ SecretDetector safety net)
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

## Documentation

- [Architecture](docs/architecture.md) — pipeline design, type schemas, MCP tool surface, package dependencies
- [Security and Privacy](docs/security-and-privacy.md) — secret handling, data storage rules, LLM usage policy
- [Product Vision](docs/product-vision.md) — product thesis, UX workflow, memory quality criteria
- [Roadmap](docs/roadmap.md) — phased delivery plan from local MVP to hosted mode
- [Contributing](CONTRIBUTING.md) — setup, development workflow, PR guidelines
