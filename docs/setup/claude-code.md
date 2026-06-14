# OpenMembrane Setup: Claude Code

Claude Code supports MCP servers natively. No adapter code is needed — just configuration.

## Prerequisites

- Node.js >= 18
- `openmembrane` installed: `npm install -g openmembrane`

## Configuration

Add the OpenMembrane MCP server to your project-level `.mcp.json` file (recommended) or global Claude Code settings.

### Project-level (`.mcp.json` in project root)

```json
{
  "mcpServers": {
    "openmembrane": {
      "command": "openmembrane",
      "args": ["serve"],
      "env": {
        "OPENMEMBRANE_PROJECT_ID": "my-project"
      }
    }
  }
}
```

### Global (`~/.claude/settings.json`)

```json
{
  "mcpServers": {
    "openmembrane": {
      "command": "openmembrane",
      "args": ["serve"],
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

Once configured, Claude Code can use these tools:

| Tool | Description |
|------|-------------|
| `remember` | Save structured memory directly (content + type). No API key needed. |
| `propose_memory_from_session` | Ingest a session transcript — requires configured LLM extractor |
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
3. Claude can call `remember` to save durable knowledge as it's discovered (no API key needed).
4. In future sessions, Claude can call `get_relevant_context` to retrieve stored project memory.
5. Run `export_static_memory_files` to generate a `CLAUDE.md` file that Claude loads automatically.

## Verify It Works

In a Claude Code session, ask:

> "Use the OpenMembrane tools to list any stored project memories."

Claude should invoke `search_memory` or `get_project_rules` and return results (or confirm no memories exist yet).

## Global Instructions (Recommended)

To ensure Claude automatically uses OpenMembrane every session, add instructions
to your global `~/.claude/CLAUDE.md` file. Create or append to it:

```
# OpenMembrane

When OpenMembrane MCP tools are available (prefixed with openmembrane_):

At session start:
- Call get_project_rules to load coding rules and constraints.
- Call get_relevant_context with a description of the current task.
- Call list_memory_candidates to check for pending candidates. Surface any
  pending candidates for approval or rejection.

During the session:
- When you discover durable knowledge (rules, gotchas, architecture decisions),
  call remember right away with structured content and type.
- Example: remember({ content: "Use Angular standalone components.", type: "coding_rule" })
- Also save memories at natural pauses and before ending a session.
```

This works globally across all projects without per-project configuration.

## Troubleshooting

- **"Server not found"**: Ensure `openmembrane` is on your PATH (`which openmembrane`).
- **No tools appear**: Check `.mcp.json` is in the project root and restart Claude Code.
- **Permission errors**: Ensure the storage directory is writable.
