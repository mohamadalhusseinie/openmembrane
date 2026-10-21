# OpenMembrane Local Private Setup: VS Code Copilot

VS Code with GitHub Copilot supports the OpenMembrane extension for automatic
MCP registration, local daemon startup, chat retrieval and candidate review.
Manual MCP configuration remains an alternative.

This guide configures the current [Local Private mode](../deployment-modes.md#local-private).
Local Private remains the default. [GitHub Team](../deployment-modes.md#github-team)
is also current; Self-Hosted Team and Managed Team are planned. Static exports
are separate from team sync.

## Prerequisites

- For manual MCP setup: Node.js >= 18 and `openmembrane` installed with
  `npm install -g openmembrane`
- VS Code with GitHub Copilot extension (agent mode)

## Extension setup (recommended)

The extension is currently distributed from source as a VSIX, not through a
Marketplace listing. In the OpenMembrane repository, run:

```sh
npm ci
npm run package -w packages/adapter-vscode
```

Run **Extensions: Install from VSIX...**, select the generated file in
`packages/adapter-vscode/`, and open a trusted project in VS Code 1.104 or newer.
The extension bundles the CLI, so a global `openmembrane` installation is not
required for this path. Accept VS Code's MCP trust/start prompt and enable the
OpenMembrane tools in Copilot Chat. No `.vscode/mcp.json` is needed; remove any
old manual registration to avoid duplicates.

Use `@openmembrane /rules`, `/recall <query>`, or `/review`. The command palette
also exposes candidate review in a webview, static file export (with
confirmation), diagnostics, and **Save chat session to OpenMembrane**.
Multi-root workspaces prompt for the target project.

**Capture boundary:** stable VS Code APIs do not expose all Copilot chat
transcripts or session-end events. Export a chat using **Chat: Export Chat...**,
then run **Save chat session to OpenMembrane**, choose the export, and confirm.
JSON exports are decoded to message text before daemon redaction; tool payloads,
reference metadata, and thinking parts are excluded. Normalized transcripts
must contain at most 100,000 characters (selected files must be at most 1 MB).
`/save` captures only history
visible to `@openmembrane`. The opt-in `openmembrane.autoSave` setting defaults
to `false` and captures only completed `/rules` and `/recall` exchanges handled
by that participant, not other Copilot chats.
Participant conversation IDs are retained in chat response metadata across saves;
imports use the export's path as their stable identity. Re-saving an extended
conversation or updating the same export file therefore honors earlier candidate
rejections. Moving an export to a different path starts a new import identity.

Capture goes through the local daemon's redaction/extraction/approval pipeline.
An explicitly configured external extractor can receive redacted captures;
check daemon policy before saving sensitive chats. Enabling MCP retrieval for
Copilot can send retrieved memory to Copilot's model. See the
[extension README](../../packages/adapter-vscode/README.md) for details,
build/host-test instructions, and limitations.

## Manual MCP configuration (alternative)

Add the OpenMembrane MCP server to your VS Code settings.

If upgrading an existing configuration, replace `args: ["serve"]` with
`args: ["mcp"]` (or omit arguments). `serve` now runs the HTTP daemon,
not MCP stdio. Restart the configured MCP server after updating it.

### Project-level (`.vscode/mcp.json` in project root)

```json
{
  "servers": {
    "openmembrane": {
      "type": "stdio",
      "command": "openmembrane",
      "args": ["mcp"],
      "env": {
        "OPENMEMBRANE_PROJECT_ID": "my-project"
      }
    }
  }
}
```

### User-level (`settings.json`)

```json
{
  "github.copilot.chat.mcp.servers": {
    "openmembrane": {
      "type": "stdio",
      "command": "openmembrane",
      "args": ["mcp"],
      "env": {
        "OPENMEMBRANE_HOME": "/path/to/.openmembrane"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENMEMBRANE_HOME` | `.openmembrane` (in cwd) | Storage directory |
| `OPENMEMBRANE_PROJECT_ID` | basename of cwd | Default project identifier |
| `OPENMEMBRANE_STORAGE_BACKEND` | `json` | Storage backend: `json` or `sqlite` |

## Available Tools

Once configured, Copilot in agent mode can use these tools:

The first tool call auto-starts the local daemon if needed. Subsequent calls
reuse it; merely listing tools does not start it. Maintenance uses the CLI or
review UI; see [MCP migration](../mcp-migration.md).

| Tool | Description |
|------|-------------|
| `remember` | Save structured memory directly (content + type). No API key needed. |
| `get_project_rules` | Retrieve rule-type memories for the project |
| `get_relevant_context` | Ranked memory retrieval by relevance query |
| `search_memory` | Search memories by query, scope, type, or tags |
| `list_memory_candidates` | List pending candidates awaiting approval |
| `approve_memory_candidate` | Approve a pending candidate |
| `reject_memory_candidate` | Reject a pending candidate |

## Quick Start

1. Add `.vscode/mcp.json` to your project root.
2. Open the Copilot Chat panel in agent mode (select "Agent" from the mode dropdown).
3. Copilot can call `remember` to save durable knowledge as it's discovered (no API key needed).
4. In future sessions, Copilot can call `get_relevant_context` to retrieve stored project memory.
5. Run `openmembrane export --targets copilot` in a terminal to generate `.github/copilot-instructions.md`.

## Verify It Works

In a Copilot agent mode chat, ask:

> "Use the OpenMembrane tools to search for any stored project memories."

Copilot should invoke `search_memory` and return results (or confirm no memories exist yet).

## Global Instructions (Recommended)

To ensure Copilot automatically uses OpenMembrane every session, create a
user-level instruction file.

Create `~/.copilot/instructions/openmembrane.instructions.md`:

```markdown
---
applyTo: "**"
---
When OpenMembrane MCP tools are available (prefixed with openmembrane_):

At session start:
- Call get_project_rules to load coding rules and constraints.
- Call get_relevant_context with a description of the current task.
- Call list_memory_candidates to check for pending candidates. Surface any
  pending candidates for approval or rejection.
- Use approve_memory_candidate or reject_memory_candidate after the
  developer decides what to retain.

During the session:
- When you discover durable knowledge (rules, gotchas, architecture decisions),
  call remember right away with structured content and type.
- Example: remember({ content: "Use Angular standalone components.", type: "coding_rule" })
- Also save memories at natural pauses and before ending a session.
```

VS Code automatically discovers `*.instructions.md` files in
`~/.copilot/instructions/` and applies them based on the `applyTo` pattern. No
settings change is needed.

This works globally across all projects without per-project configuration.

## Troubleshooting

- **"Server not found"**: Ensure `openmembrane` is on your PATH.
- **No tools appear**: Verify `.vscode/mcp.json` exists, restart VS Code, and ensure Copilot is in agent mode.
- **Permission errors**: Ensure the storage directory is writable.
- **MCP not supported**: Ensure you have the latest GitHub Copilot extension version.
