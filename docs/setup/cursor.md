# OpenMembrane Local Private Setup: Cursor

Cursor supports MCP servers natively. No adapter code is needed — just configuration.

This guide configures the current [Local Private mode](../deployment-modes.md#local-private).
Local Private remains the default. [GitHub Team](../deployment-modes.md#github-team)
is also current; Self-Hosted Team and Managed Team are planned. Static exports
are separate from team sync.

## Prerequisites

- Node.js >= 18
- `openmembrane` installed: `npm install -g openmembrane`

## Configuration

Add the OpenMembrane MCP server in Cursor's settings.

If upgrading an existing configuration, replace `args: ["serve"]` with
`args: ["mcp"]` (or omit arguments). `serve` now runs the HTTP daemon,
not MCP stdio. Restart Cursor after updating the configuration.

### Project-level (`.cursor/mcp.json` in project root)

```json
{
  "mcpServers": {
    "openmembrane": {
      "command": "openmembrane",
      "args": ["mcp"],
      "env": {
        "OPENMEMBRANE_PROJECT_ID": "my-project"
      }
    }
  }
}
```

### Global (Cursor Settings > MCP Servers)

1. Open Cursor Settings (Cmd/Ctrl + ,)
2. Search for "MCP"
3. Add a new MCP server with:
   - **Name**: `OpenMembrane`
   - **Command**: `openmembrane`
   - **Args**: `["mcp"]`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENMEMBRANE_HOME` | `.openmembrane` (in cwd) | Storage directory |
| `OPENMEMBRANE_PROJECT_ID` | basename of cwd | Default project identifier |
| `OPENMEMBRANE_STORAGE_BACKEND` | `json` | Storage backend: `json` or `sqlite` |

## Available Tools

Once configured, Cursor can use these tools:

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

1. Add the `.cursor/mcp.json` config to your project.
2. Restart Cursor or reload the window.
3. In a chat session, Cursor can call `remember` to save durable knowledge as it's discovered (no API key needed).
4. In future sessions, Cursor can call `get_relevant_context` to retrieve stored project memory.
5. Run `openmembrane export --targets cursor` in a terminal to generate static memory files.

## Verify It Works

In a Cursor chat session, ask:

> "Use the OpenMembrane tools to search for any stored project memories."

Cursor should invoke `search_memory` and return results (or confirm no memories exist yet).

## Global Instructions (Recommended)

To ensure Cursor automatically uses OpenMembrane every session, add global AI
rules:

1. Open Cursor Settings (Cmd/Ctrl + ,)
2. Navigate to General > Rules for AI
3. Add the following:

```
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

This works globally across all projects without per-project configuration.

## Troubleshooting

- **"Server not found"**: Ensure `openmembrane` is on your PATH (`which openmembrane` or `where openmembrane`).
- **No tools appear**: Check `.cursor/mcp.json` exists and restart Cursor.
- **Permission errors**: Ensure the storage directory is writable.
