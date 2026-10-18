# OpenMembrane Local Private Setup: OpenCode

For automatic context injection and session capture without AI tool calls, use
the [OpenCode plugin setup](../docs/setup/opencode.md). The guide below remains
available for optional, tool-driven MCP access.

This guide configures the current [Local Private mode](../docs/deployment-modes.md#local-private).
Local Private remains the default. [GitHub Team](../docs/deployment-modes.md#github-team)
is also current; Self-Hosted Team and Managed Team are planned. Static exports
are separate from team sync.

## Prerequisites

- Node.js 18+
- OpenCode installed and running

## Installation

1. Open the OpenCode configuration file at `~/.config/opencode/opencode.json`
   (on Windows: `%USERPROFILE%\.config\opencode\opencode.json`)

2. Add the following entry inside the `"mcp"` object:

   ```json
   "openmembrane": {
     "type": "local",
     "command": ["npx", "-y", "openmembrane"]
   }
   ```

   If the `"mcp"` key does not exist yet, create it:

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

3. Restart OpenCode to pick up the new MCP server.

4. Verify the installation by using the `get_project_rules` tool. If it responds
   without error, OpenMembrane is connected. This first tool call auto-starts
   the local daemon if needed; later calls reuse it.

## Development (from source)

If you are contributing to OpenMembrane and want to run from source without
rebuilding between changes:

```json
"openmembrane": {
  "type": "local",
  "command": ["npx", "tsx", "/absolute/path/to/OpenMembrane/apps/mcp-server/src/index.ts"]
}
```

Replace `/absolute/path/to/OpenMembrane` with the absolute path to your local
clone of the repository.

## Optional: Enable LLM Extraction

The primary workflow uses the `remember` tool — no API keys needed. The AI tool
calls `remember` directly with structured content and type, and memories are
auto-saved through the full pipeline.

Full-transcript extraction is a CLI/daemon operation, not an MCP tool.
Configure the extractor in the daemon's environment before starting it, then
submit a transcript from your project directory:

```sh
openmembrane start
openmembrane ingest --file session.txt --tool opencode
```

For example, set `OPENMEMBRANE_EXTRACTION_API_KEY` in the daemon's environment.
An already-running daemon does not adopt later MCP environment changes.

Any OpenAI-compatible endpoint works (Ollama, Groq, Together, vLLM, OpenRouter,
etc.) — set `OPENMEMBRANE_EXTRACTION_BASE_URL` to point to your provider and
`OPENMEMBRANE_EXTRACTION_MODEL` to select the model. For local models that don't
support JSON mode, also set `OPENMEMBRANE_EXTRACTION_JSON_MODE=false`.

## Global Instructions (Recommended)

To ensure OpenCode's AI automatically loads project memory at session start and
saves durable knowledge as it's discovered, create a global instruction file and
reference it in your config.

1. Create `~/.config/openmembrane/instructions.md` with content like:

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
     call remember right away with structured content and type. Do not wait for
     the session to end.
   - Example: remember({ content: "CI requires Node 18+.", type: "known_gotcha" })
   - Also save memories at natural pauses and before ending a session.
   ```

2. Add `"instructions"` to `~/.config/opencode/opencode.json`:

   ```json
   {
     "instructions": ["~/.config/openmembrane/instructions.md"]
   }
   ```

3. Restart OpenCode to pick up the change.

This works globally across all projects. No per-project configuration needed.

## Troubleshooting

- **Server not connecting:** Ensure OpenCode was restarted after editing
  `opencode.json`. Check that the JSON is valid (no trailing commas).
- **npx not found:** Ensure Node.js 18+ is installed and `npx` is on your PATH.
- **Tools not appearing:** OpenCode prefixes MCP tools with the server name
  (e.g., `openmembrane_get_project_rules`). Check that the server is enabled.
