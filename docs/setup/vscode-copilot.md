# OpenMemBrain Setup: VS Code Copilot

VS Code with GitHub Copilot supports MCP servers. No adapter code is needed — just configuration.

## Prerequisites

- Node.js >= 18
- `openmembrain` installed: `npm install -g openmembrain`
- VS Code with GitHub Copilot extension (agent mode)

## Configuration

Add the OpenMemBrain MCP server to your VS Code settings.

### Project-level (`.vscode/mcp.json` in project root)

```json
{
  "servers": {
    "openmembrain": {
      "type": "stdio",
      "command": "openmembrain",
      "args": ["serve"],
      "env": {
        "OPENMEMBRAIN_PROJECT_ID": "my-project"
      }
    }
  }
}
```

### User-level (`settings.json`)

```json
{
  "github.copilot.chat.mcp.servers": {
    "openmembrain": {
      "type": "stdio",
      "command": "openmembrain",
      "args": ["serve"],
      "env": {
        "OPENMEMBRAIN_HOME": "/path/to/.openmembrain"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENMEMBRAIN_HOME` | `.openmembrain` (in cwd) | Storage directory |
| `OPENMEMBRAIN_PROJECT_ID` | basename of cwd | Default project identifier |
| `OPENMEMBRAIN_STORAGE_BACKEND` | `json` | Storage backend: `json` or `sqlite` |

## Available Tools

Once configured, Copilot in agent mode can use these tools:

| Tool | Description |
|------|-------------|
| `propose_memory_from_session` | Ingest a session transcript — extract, classify, filter, persist |
| `get_project_rules` | Retrieve rule-type memories for the project |
| `get_relevant_context` | Ranked memory retrieval by relevance query |
| `search_memory` | Search memories by query, scope, type, or tags |
| `list_memory_candidates` | List pending candidates awaiting approval |
| `approve_memory_candidate` | Approve a pending candidate |
| `reject_memory_candidate` | Reject a pending candidate |
| `export_static_memory_files` | Generate AGENTS.md, CLAUDE.md, and other static files |
| `review_stale_memories` | List memories not updated in N months |
| `get_diagnostics` | Query diagnostic events |
| `supersede_memory` | Mark a memory as superseded |
| `update_memory` | Update content/type/scope/tags of a memory |
| `list_audit_log` | Return recent audit events |

## Quick Start

1. Add `.vscode/mcp.json` to your project root.
2. Open the Copilot Chat panel in agent mode (select "Agent" from the mode dropdown).
3. Copilot can call `propose_memory_from_session` to extract durable knowledge from sessions.
4. In future sessions, Copilot can call `get_relevant_context` to retrieve stored project memory.
5. Run `export_static_memory_files` to generate static memory files (e.g., `.github/copilot-instructions.md`).

## Verify It Works

In a Copilot agent mode chat, ask:

> "Use the openmembrain tools to search for any stored project memories."

Copilot should invoke `search_memory` and return results (or confirm no memories exist yet).

## Troubleshooting

- **"Server not found"**: Ensure `openmembrain` is on your PATH.
- **No tools appear**: Verify `.vscode/mcp.json` exists, restart VS Code, and ensure Copilot is in agent mode.
- **Permission errors**: Ensure the storage directory is writable.
- **MCP not supported**: Ensure you have the latest GitHub Copilot extension version.
