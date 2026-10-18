# OpenCode: automatic memory adapter

The OpenCode plugin is the reference adapter: it loads project rules and
relevant context before model requests, then captures the conversation whenever
the session becomes idle. The AI does not need to choose to call a memory tool.

This uses [Local Private mode](../deployment-modes.md#local-private) by default.
All extraction, secret redaction, and save/approval policy remain in the daemon.

## Install

With Node.js 18+ installed, add the npm plugin to your project `opencode.json`
or `~/.config/opencode/opencode.json` (Windows:
`%USERPROFILE%\.config\opencode\opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@openmembrane/adapter-opencode"]
}
```

Preserve other settings and restart OpenCode. OpenCode installs the plugin;
the plugin automatically starts the local daemon if needed. See the
[package README](../../packages/adapter-opencode/README.md) for the verified
OpenCode API version, exact hooks, development setup, and project detection.

The plugin can coexist with the MCP server for explicit search and review tools.
Remove old instructions that require the AI to save the same conversation
manually if you no longer need them. MCP is not required for automatic capture.

## Configure extraction

Without provider credentials the daemon uses the local deterministic extractor.
It recognizes simple durable project statements, not arbitrary natural language.
For richer extraction, set the following **in the daemon's environment** before
it starts:

```sh
export OPENMEMBRANE_EXTRACTION_API_KEY="your-provider-key"
export OPENMEMBRANE_EXTRACTION_BASE_URL="https://your-provider.example/v1"
export OPENMEMBRANE_EXTRACTION_MODEL="your-model"
openmembrane start
```

PowerShell uses `$env:NAME = "value"` instead of `export`. For an explicitly
configured local OpenAI-compatible model, use its local base URL and set
`OPENMEMBRANE_EXTRACTION_PROVIDER=llm` and
`OPENMEMBRANE_EXTRACTION_ENABLED=true`; no cloud service is required. If your
model does not support JSON mode, set
`OPENMEMBRANE_EXTRACTION_JSON_MODE=false`. Never commit provider keys.
An already-running daemon does not adopt later environment changes; restart it
when intentionally changing extraction settings.

## Verify

Run an ordinary OpenCode session in your project. A statement such as
"The project must use isolated Vitest fixtures for integration tests" is
recognizable by the default local extractor. After OpenCode becomes idle,
inspect `openmembrane context` and `openmembrane candidates list` from the same
directory. Saved memories are loaded automatically on
later model requests. Candidates still require review; the plugin never
auto-approves them.

## Troubleshooting

- **No memories:** Check both saved memories and pending candidates. Conversations
  without durable knowledge may be rejected by design. For arbitrary prose,
  configure extraction explicitly.
- **Daemon unavailable:** The session continues. Check OpenCode's logs for
  `service: "openmembrane"` and any daemon diagnostic ID; verify the CLI peer
  dependency is installed and the daemon can start.
- **Different memories in CLI and OpenCode:** Use the same project directory,
  `OPENMEMBRANE_PROJECT_ID`, and storage environment in both.
- **Very large conversations:** The daemon protocol limits transcript size.
  Oversized submissions are logged and not truncated; start a new session.

## Uninstall

Remove the plugin entry from your OpenCode config and restart OpenCode. Automatic
capture and injection stop. Stored memories and separately configured MCP tools
are preserved. See [the legacy MCP setup](../../.opencode/INSTALL.md) if you want
manual tool-driven use instead.
