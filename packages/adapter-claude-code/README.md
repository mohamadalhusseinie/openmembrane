# OpenMembrane adapter for Claude Code

Automatically capture local Claude Code sessions without asking the model to
call `remember`. Requires Node.js >= 18 and a Claude Code version supporting
exec-form command hooks (`command` plus `args`).

```sh
npx @openmembrane/adapter-claude-code install
# Optional: also capture at the end of every assistant turn.
npx @openmembrane/adapter-claude-code install --incremental
npx @openmembrane/adapter-claude-code uninstall
```

Restart Claude Code after changing hooks. The default is `SessionEnd` only;
`--incremental` additionally registers `Stop`. Reinstall without the flag to
disable incremental capture. Incremental capture submits full transcript
snapshots with the stable Claude session ID, so daemon deduplication and
rejection tracking apply across turns.

The installer merges hooks into `~/.claude/settings.json`, appends a retrieval
instruction block between `<!-- openmembrane:start -->` and
`<!-- openmembrane:end -->` in `~/.claude/CLAUDE.md`, and keeps a local restoration
record in `openmembrane-adapter-state.json` (which may contain your original
settings). `CLAUDE_CONFIG_DIR` overrides this directory. It does not change MCP
server configuration or enable memory egress.

The bundled capture handler is copied to `openmembrane-capture.mjs`. Hooks invoke
Node directly, with separate path arguments, so spaces and shell metacharacters
are safe on Windows, macOS, and Linux. The installed `openmembrane` dependency is
resolved during installation; keep that installation (or npx cache) available.
If you remove it, rerun install to refresh the path.

Hook JSON supplies `cwd`, `session_id` and `transcript_path`. The handler reads Claude's JSONL
transcript, selects user/assistant text (not tool payloads, thinking blocks, or
sidechains), starts the local daemon if needed, then pipes text to
`openmembrane ingest --stdin --tool claude-code --format text --session-id <id>`
from `CLAUDE_PROJECT_DIR` (falling back to hook `cwd` if it is not set).
This keeps capture anchored to the session project even after a directory change.
On `Stop`, `last_assistant_message` supplies the just-finished response if it
is not yet present in the transcript file. Long transcripts, including oversized
individual turns, are split into sequential requests within the daemon limit
without dropping text.
Ingestion is detached after its input has been handed off, so it can finish
after Claude exits without exceeding Claude's 60-second SessionEnd budget. The
worker keeps transcripts in memory and pipes each bounded chunk to CLI ingestion.
Ingestion errors are written to `openmembrane-capture.log` in the config directory;
this log is retained on uninstall for troubleshooting.
Empty text does nothing. Failures are non-blocking hook errors on stderr;
raw transcripts are never copied to the adapter directory or echoed to Claude.
The daemon owns extraction, redaction, policy, deduplication, and persistence.
Extraction/provider setup is the same as ordinary CLI ingestion.
Hooks inherit the environment that launches Claude Code, not `.mcp.json`
server `env` values. Share any `OPENMEMBRANE_PROJECT_ID`, `OPENMEMBRANE_HOME`
and `OPENMEMBRANE_STORAGE_BACKEND` overrides with that launch environment
and MCP configuration so capture and retrieval target the same project/store.

Repeated installs are idempotent. Uninstall restores original files byte-for-byte
when they are otherwise unchanged (and removes files the installer created).
If you edited them afterward, only the adapter's hooks and marked instruction
block are removed; unrelated hooks and text are retained. Do not delete the
restoration record before uninstalling.

Retrieval requires the separately configured OpenMembrane MCP server and explicit
permission to send stored memory to the chosen model. See the
[Claude Code setup guide](../../docs/setup/claude-code.md) and
[official hook reference](https://code.claude.com/docs/en/hooks).
