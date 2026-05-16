# OpenMemBrain — OpenCode Installation

## Prerequisites

- Node.js 18+
- OpenCode installed and running

## Installation

1. Open the OpenCode configuration file at `~/.config/opencode/opencode.json`
   (on Windows: `%USERPROFILE%\.config\opencode\opencode.json`)

2. Add the following entry inside the `"mcp"` object:

   ```json
   "openmembrain": {
     "type": "local",
     "command": ["npx", "-y", "openmembrain"]
   }
   ```

   If the `"mcp"` key does not exist yet, create it:

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

3. Restart OpenCode to pick up the new MCP server.

4. Verify the installation by using the `get_project_rules` tool. If it responds
   without error, OpenMemBrain is connected.

## Development (from source)

If you are contributing to OpenMemBrain and want to run from source without
rebuilding between changes:

```json
"openmembrain": {
  "type": "local",
  "command": ["npx", "tsx", "/absolute/path/to/openmembrain/apps/mcp-server/src/index.ts"]
}
```

Replace `/absolute/path/to/openmembrain` with the absolute path to your local
clone of the repository.

## Optional: Enable LLM Extraction

By default, OpenMemBrain uses a mock extractor (no API keys needed). All tools
work — you can manually manage memories, search, export, etc.

To enable real memory extraction from session transcripts, add environment
variables to the MCP config:

```json
"openmembrain": {
  "type": "local",
  "command": ["npx", "-y", "openmembrain"],
  "environment": {
    "OPENMEMBRAIN_EXTRACTION_PROVIDER": "openai",
    "OPENMEMBRAIN_EXTRACTION_ENABLED": "true",
    "OPENMEMBRAIN_OPENAI_API_KEY": "your-openai-api-key"
  }
}
```

## Global Instructions (Recommended)

To ensure OpenCode's AI automatically loads project memory at session start and
saves durable knowledge at session end, create a global instruction file and
reference it in your config.

1. Create `~/.config/openmembrain/instructions.md` with content like:

   ```
   When OpenMemBrain MCP tools are available (prefixed with openmembrain_):

   At session start:
   - Call get_project_rules to load coding rules and constraints.
   - Call get_relevant_context with a description of the current task.

   At session end:
   - Call propose_memory_from_session with a summary of durable knowledge.
   - Use prefixes: rule:, architecture:, gotcha:, testing:, security:,
     deployment:, forbidden:, remember:, domain:.
   ```

2. Add `"instructions"` to `~/.config/opencode/opencode.json`:

   ```json
   {
     "instructions": ["~/.config/openmembrain/instructions.md"]
   }
   ```

3. Restart OpenCode to pick up the change.

This works globally across all projects. No per-project configuration needed.

## Troubleshooting

- **Server not connecting:** Ensure OpenCode was restarted after editing
  `opencode.json`. Check that the JSON is valid (no trailing commas).
- **npx not found:** Ensure Node.js 18+ is installed and `npx` is on your PATH.
- **Tools not appearing:** OpenCode prefixes MCP tools with the server name
  (e.g., `openmembrain_get_project_rules`). Check that the server is enabled.
