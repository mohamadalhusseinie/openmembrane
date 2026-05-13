# OpenMemBrain Setup: Claude Code

Claude Code supports MCP servers natively. No adapter code is needed — just configuration.

## Prerequisites

- Node.js >= 18
- `openmembrain` installed: `npm install -g openmembrain`

## Configuration

Add the OpenMemBrain MCP server to your project-level `.mcp.json` file (recommended) or global Claude Code settings.

### Project-level (`.mcp.json` in project root)

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

### Global (`~/.claude/settings.json`)

```json
{
  "mcpServers": {
    "openmembrain": {
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

Once configured, Claude Code can use these tools:

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

1. Add the `.mcp.json` config to your project root.
2. Start a Claude Code session. The MCP tools are now available.
3. At the end of a session, Claude can call `propose_memory_from_session` to extract durable knowledge.
4. In future sessions, Claude can call `get_relevant_context` to retrieve stored project memory.
5. Run `export_static_memory_files` to generate a `CLAUDE.md` file that Claude loads automatically.

## Verify It Works

In a Claude Code session, ask:

> "Use the openmembrain tools to list any stored project memories."

Claude should invoke `search_memory` or `get_project_rules` and return results (or confirm no memories exist yet).

## Troubleshooting

- **"Server not found"**: Ensure `openmembrain` is on your PATH (`which openmembrain`).
- **No tools appear**: Check `.mcp.json` is in the project root and restart Claude Code.
- **Permission errors**: Ensure the storage directory is writable.
