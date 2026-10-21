# OpenMembrane

OpenMembrane is the intelligent membrane for AI coding memory. It autonomously reads and learns from your coding sessions — you never have to tell it what to save. It selectively absorbs project knowledge, blocks secrets, filters noise, resolves conflicts, and persists only what matters.

No manual effort. No data leaves your machine unless you choose it. Safe, private, and trustworthy by design.

## Table of Contents

- [Installation](#installation)
- [Configuring Your AI Tool](#configuring-your-ai-tool)
  - [Claude Desktop](#claude-desktop)
  - [Claude Code](#claude-code)
  - [Codex](#codex)
  - [VS Code / GitHub Copilot](#vs-code--github-copilot)
  - [Cursor](#cursor)
  - [OpenCode](#opencode)
- [Automatic Memory Capture](#automatic-memory-capture)
- [Deployment Modes](#deployment-modes)
- [Environment Variables](#environment-variables)
- [MCP Tools](#mcp-tools)
- [Architecture](#architecture)
- [Diagnostics And Errors](#diagnostics-and-errors)
- [Static Fallback Files](#static-fallback-files)
- [Development](#development)
- [Documentation](#documentation)

- **Zero-effort** — learns from sessions automatically, no commands or prompts needed
- **Secure by default** — secrets are detected and rejected before they ever reach storage
- **Self-managing** — deduplicates, resolves conflicts, and filters noise on its own
- **Local Private by default** — memory is stored locally in git-ignored `.openmembrane/`
- **Tool-agnostic** — dedicated adapters for OpenCode, Claude Code, Codex and VS Code/Copilot, plus MCP for Cursor, Claude Desktop and others

## Installation

Install and run the MCP server with npx (requires Node.js >= 18):

```sh
npx openmembrane
```

Or install globally:

```sh
npm install -g openmembrane
openmembrane
```

No cloud account is required for the default Local Private mode, which stores
memory locally in git-ignored `.openmembrane/`.

The local daemon has explicit lifecycle commands:

```sh
openmembrane serve   # foreground
openmembrane start   # detached
openmembrane status
openmembrane stop
```

Bare `openmembrane` and `openmembrane mcp` both launch MCP stdio.
CLI data commands and the review UI use the authenticated local daemon.
Run `openmembrane start` first; these surfaces report an error if the daemon
is unavailable and never fall back to opening stores themselves. MCP uses
the same client and auto-starts the daemon on the first tool call, then
reuses it across calls and sessions. Listing tools does not start it. See
[Daemon Protocol](docs/daemon-protocol.md) for transport, authentication,
and per-project request settings.

### CLI and local review

Run these commands from your project directory. `--project <id>` overrides
`OPENMEMBRANE_PROJECT_ID`; `OPENMEMBRANE_HOME` selects project storage, not
the per-user daemon endpoint.

```sh
openmembrane ingest --file session.txt --tool codex
openmembrane ingest --stdin --tool claude-code --session-id session-123
openmembrane context --query "deployment rules" --output markdown
openmembrane candidates list --output json
openmembrane candidates approve <id>
openmembrane candidates reject <id> --reason "Obsolete"
openmembrane candidates approve-all
openmembrane candidates reject-all
openmembrane memory update <id> --content "Updated project rule"
openmembrane memory supersede <id> --reason "Replaced" --replacement-id <new-id>
openmembrane memory stale --stale-after-months 6
openmembrane export --targets agents,claude --preview
openmembrane export --targets agents,claude --output-dir generated
openmembrane diagnostics --severity warning --limit 100
openmembrane audit --limit 100
openmembrane team configure --owner my-team --repo private-memory
openmembrane team status
```

All data commands support `--output text|json|markdown`. Ingest defaults to
JSON for compatibility; the others default to text. `openmembrane --help`
lists command-specific filters and options. Bulk approval skips candidates
that cannot be approved, including secrets, and reports each skipped ID.
GitHub Team mutations report publication/retry state rather than implying
that an unmerged proposal is already active.

From this repository, `npm run review-ui -- --no-open` starts the loopback
review UI. It provides memory search, editing and superseding, candidate
review (individual and bulk), audit, diagnostics, stale-memory review, and
static-export preview/write. Preview never writes files. Export excludes
confidential memories unless you explicitly opt in.

## Configuring Your AI Tool

Pick the integration for your tool. Adapters capture sessions and retrieve
memory automatically through the local daemon; MCP is the fallback for tools
without an adapter. Every setup needs the CLI installed first
(`npm install -g openmembrane`).

| Tool | Integration | Setup guide |
|------|-------------|-------------|
| OpenCode | `@openmembrane/adapter-opencode` plugin | [OpenCode setup](docs/setup/opencode.md) |
| Claude Code | `@openmembrane/adapter-claude-code` hooks | [Claude Code setup](docs/setup/claude-code.md) |
| VS Code / GitHub Copilot | VS Code extension | [VS Code setup](docs/setup/vscode-copilot.md) |
| Codex | `@openmembrane/adapter-codex` hooks | [Codex setup](docs/setup/codex.md) |
| Cursor | MCP config (fallback) | [Cursor setup](docs/setup/cursor.md) |
| Claude Desktop | MCP config (fallback) | [below](#claude-desktop) |

The MCP server runs over stdio and auto-starts the daemon on its first tool
call. Add it to your AI tool's MCP configuration:

### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "openmembrane": {
      "command": "npx",
      "args": ["openmembrane"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add openmembrane -- npx openmembrane
```

### Codex

For automatic session capture with native hooks and startup retrieval
instructions, follow [Codex setup](docs/setup/codex.md):

```sh
npm install -g openmembrane
npx @openmembrane/adapter-codex install
```

Restart Codex and review/trust the hook with `/hooks`. MCP retrieval is
configured separately and requires explicit permission for stored-memory egress.

### VS Code / GitHub Copilot

The [VS Code extension](packages/adapter-vscode/README.md) bundles the CLI,
starts the local daemon and registers MCP retrieval without manual configuration.
It also adds `@openmembrane /rules`, `/recall`, `/review`, candidate review,
export and diagnostics commands, and explicit chat export capture. Stable
VS Code APIs do not expose all Copilot sessions; opt-in auto-save covers only
the extension's own participant exchanges.
See [VS Code setup](docs/setup/vscode-copilot.md) for VSIX installation.

Alternatively, add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "openmembrane": {
      "command": "npx",
      "args": ["openmembrane"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "openmembrane": {
      "command": "npx",
      "args": ["openmembrane"]
    }
  }
}
```

### OpenCode

For automatic session capture and opt-in context injection, follow
[OpenCode plugin setup](docs/setup/opencode.md). It covers installation,
explicit consent to send stored memory to OpenCode's model provider, extraction
configuration, and uninstall instructions.

For optional MCP tools, add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "openmembrane": {
      "type": "local",
      "command": ["npx", "-y", "openmembrane"]
    }
  }
}
```

See [`.opencode/INSTALL.md`](.opencode/INSTALL.md) for detailed setup including
global instructions and development-from-source configuration.

## Automatic Memory Capture

Adding the MCP server gives your AI tool access to OpenMembrane's tools. To
ensure the AI uses them automatically — loading project memory at session start
and saving durable knowledge as it's discovered — add a global instruction file.

Create `~/.config/openmembrane/instructions.md` with instructions for the AI to:

- Call `get_project_rules`, `get_relevant_context`, and `list_memory_candidates`
  at the start of each session.
- Use `approve_memory_candidate` or `reject_memory_candidate` after the
  developer decides what to retain.
- Call `remember` proactively when durable knowledge is discovered, providing
  structured content and a type (e.g., `coding_rule`, `known_gotcha`,
  `architecture_decision`). No API key needed.

Then wire the file into your tool's global configuration:

| Platform | Global instruction mechanism |
|----------|------------------------------|
| **OpenCode** | `"instructions": ["~/.config/openmembrane/instructions.md"]` in `~/.config/opencode/opencode.json` |
| **Claude Code** | Append to `~/.claude/CLAUDE.md` |
| **Codex** | Adapter-managed section in `~/.codex/AGENTS.md` |
| **Cursor** | Add to Rules for AI in Cursor Settings |
| **VS Code / Copilot** | Create `~/.copilot/instructions/openmembrane.instructions.md` with `applyTo: "**"` |

See the platform-specific setup guides in [`docs/setup/`](docs/setup/) for
detailed instructions.

Alternatively, run `openmembrane export` from any project to generate
per-project instruction files (AGENTS.md, CLAUDE.md, etc.) that include both
usage instructions and stored memories.

## Deployment Modes

OpenMembrane ships [Local Private mode](docs/deployment-modes.md#local-private)
by default and [GitHub Team mode](docs/deployment-modes.md#github-team) for
shared memory through a dedicated private repository. Self-Hosted Team and
Managed Team are planned. Static exported files are separate from team sync;
see [Deployment Modes](docs/deployment-modes.md) for the approved-memory
boundary and GitHub pull-request workflow.

## Environment Variables

By default, local memory is stored in `.openmembrane` under the current working directory. Override this with:

- `OPENMEMBRANE_HOME`: directory for local JSON memory stores.
- `OPENMEMBRANE_PROJECT_ID`: default project id when a tool call does not pass `projectId`.

## MCP Tools

- `remember` — save structured memory directly. Provide content, type, and optional scope/tags. No API key needed. Supports single and batch mode.
- `get_project_rules` — retrieve project rules and conventions for the current scope.
- `get_relevant_context` — find memories relevant to a natural language query.
- `search_memory` — search saved memories by query, scope, type, or tags.
- `list_memory_candidates` — list pending memory candidates awaiting approval.
- `approve_memory_candidate` — approve a pending candidate to save it as memory.
- `reject_memory_candidate` — reject a pending candidate with an optional reason.

These are the seven mid-session MCP tools. Transcript ingestion, bulk review,
memory maintenance, export, diagnostics, audit, and team configuration are
user operations available through the [CLI and review UI](#cli-and-local-review).
See [MCP migration](docs/mcp-migration.md) for each removed tool's replacement.

## Architecture

OpenMembrane supports two paths for saving memory:

1. **`remember` (primary):** The AI tool calls `remember` directly with structured content and type. No server-side LLM needed. Memories go through the full pipeline (secret detection, policy filtering, deduplication) and are auto-saved.

2. **`openmembrane ingest` (secondary):** An adapter submits a full session transcript through the CLI or daemon ingestion endpoint for server-side LLM extraction. Requires an explicitly configured daemon extractor (OpenAI or compatible provider).

```text
remember tool                          CLI / daemon ingestion
  |                                      |
  v                                      v
processStructured()                    SessionIngestor
  |                                      -> SecretDetector redaction
  v                                      -> MemoryExtractor interface
MemoryClassifier                         -> MemoryClassifier
  -> PolicyEngine                        -> PolicyEngine
  -> Deduplicator                        -> Deduplicator
  -> ConflictDetector                    -> ConflictDetector
  -> ActionRecommender                   -> ActionRecommender
  -> MemoryStore or PendingCandidateStore
```

Package responsibilities:

- `packages/core`: domain types, extraction interface, policy checks, classification, deduplication, conflict detection, and pipeline orchestration.
- `packages/storage`: local JSON persistence for saved memory, pending approvals, and audit events.
- `packages/service`: project-scoped operations, storage lifecycle, and GitHub Team synchronization owned by the daemon.
- `packages/protocol`: versioned daemon HTTP schemas and shared endpoint resolution.
- `packages/client`: authenticated local-daemon client used by MCP, CLI, review UI, and adapters.
- `packages/exporters`: static fallback file generation for AI tools that read project instruction files.
- `packages/shared`: small runtime helpers for IDs, time, and result types.
- `apps/mcp-server`: local MCP server exposing saved memory and approval workflows to AI tools.
- `apps/daemon`: authenticated per-user HTTP daemon with project-scoped stores and CLI lifecycle management.

Provider-specific LLM calls are intentionally kept out of the core. The boundary is:

```ts
interface MemoryExtractor {
  extract(input: SessionInput): Promise<MemoryCandidate[]>;
}
```

The `MockMemoryExtractor` is used for deterministic testing. The `LlmMemoryExtractor` supports OpenAI and any compatible API endpoint (via `baseUrl`).

## Diagnostics And Errors

OpenMembrane distinguishes audit history from diagnostics:

- Audit events describe normal memory activity, such as session ingestion, candidate extraction, saved memory, queued candidates, and rejected candidates.
- Diagnostics describe operational problems, such as validation errors, missing candidates, invalid local JSON stores, unsafe approval attempts, and export failures.

MCP tools return safe user-facing error payloads with a `diagnosticId`, preserving
the daemon's ID and safe message. Inspect project diagnostics with
`openmembrane diagnostics` or the review UI, and daemon failures in the local
daemon log. Client-side failures are correlated on MCP stderr, never stdout.

## Static Fallback Files

Static exporters can generate:

- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`
- `.cursor/rules/openmembrane.mdc`
- `docs/ai/project-memory.md`

These files are compatibility fallbacks for tools that cannot retrieve memory through MCP. By default, exporters omit `confidential` memories because these files may be committed to source control. Callers must explicitly opt in to include confidential memory.

## Development

```sh
git clone https://github.com/mohamadalhusseinie/openmembrane.git
cd openmembrane
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

- [Setup guides](docs/setup/) — per-tool installation for OpenCode, Claude Code, Codex, VS Code/Copilot and Cursor
- [Daemon Protocol](docs/daemon-protocol.md) — transport, authentication and lifecycle
- [Architecture](docs/architecture.md) — pipeline design, type schemas, MCP tool surface, package dependencies
- [Security and Privacy](docs/security-and-privacy.md) — secret handling, data storage rules, LLM usage policy
- [Product Vision](docs/product-vision.md) — product thesis, UX workflow, memory quality criteria
- [Deployment Modes](docs/deployment-modes.md) — current Local Private and GitHub Team modes, plus planned team modes
- [Roadmap](docs/roadmap.md) — phased delivery plan for Local Private, GitHub Team, and planned team modes
- [Contributing](CONTRIBUTING.md) — setup, development workflow, PR guidelines
