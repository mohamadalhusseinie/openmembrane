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

## Troubleshooting

- **Server not connecting:** Ensure OpenCode was restarted after editing
  `opencode.json`. Check that the JSON is valid (no trailing commas).
- **npx not found:** Ensure Node.js 18+ is installed and `npx` is on your PATH.
- **Tools not appearing:** OpenCode prefixes MCP tools with the server name
  (e.g., `openmembrain_get_project_rules`). Check that the server is enabled.
