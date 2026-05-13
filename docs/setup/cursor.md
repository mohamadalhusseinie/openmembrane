# OpenMemBrain Setup: Cursor

Cursor supports MCP servers natively. No adapter code is needed — just configuration.

## Prerequisites

- Node.js >= 18
- `openmembrain` installed: `npm install -g openmembrain`

## Configuration

Add the OpenMemBrain MCP server in Cursor's settings.

### Project-level (`.cursor/mcp.json` in project root)

```json
{
  "mcpServers": {
    "openmembrain": {
      "command": "openmembrain",
      "args": ["serve"],
      "env": {
        "OPENMEMBRAIN_PROJECT_ID": "my-project"
      }
    }
  }
}
```

### Global (Cursor Settings > MCP Servers)

1. Open Cursor Settings (Cmd/Ctrl + ,)
2. Search for "MCP"
3. Add a new MCP server with:
   - **Name**: `openmembrain`
   - **Command**: `openmembrain`
   - **Args**: `["serve"]`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENMEMBRAIN_HOME` | `.openmembrain` (in cwd) | Storage directory |
| `OPENMEMBRAIN_PROJECT_ID` | basename of cwd | Default project identifier |
| `OPENMEMBRAIN_STORAGE_BACKEND` | `json` | Storage backend: `json` or `sqlite` |

## Available Tools

Once configured, Cursor can use these tools:

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

1. Add the `.cursor/mcp.json` config to your project.
2. Restart Cursor or reload the window.
3. In a chat session, Cursor can call `propose_memory_from_session` to extract durable knowledge.
4. In future sessions, Cursor can call `get_relevant_context` to retrieve stored project memory.
5. Run `export_static_memory_files` to generate static memory files.

## Verify It Works

In a Cursor chat session, ask:

> "Use the openmembrain tools to search for any stored project memories."

Cursor should invoke `search_memory` and return results (or confirm no memories exist yet).

## Troubleshooting

- **"Server not found"**: Ensure `openmembrain` is on your PATH (`which openmembrain` or `where openmembrain`).
- **No tools appear**: Check `.cursor/mcp.json` exists and restart Cursor.
- **Permission errors**: Ensure the storage directory is writable.
