# OpenMembrane Local Private Setup: Codex

Codex supports MCP retrieval and native hooks for automatic session capture.
This guide uses [Local Private mode](../deployment-modes.md#local-private).
Install Node.js >= 18 and a current Codex release with `SessionEnd` hooks.

## Automatic capture

```sh
npx @openmembrane/adapter-codex install
```

Restart Codex, open `/hooks`, and review/trust the OpenMembrane hook.
Hooks must be enabled; the installer does not override `features.hooks = false`
or managed restrictions. It adds a `SessionEnd` command in
`~/.codex/hooks.json` and startup retrieval instructions in `~/.codex/AGENTS.md`.
`CODEX_HOME` overrides this directory. Existing settings and instructions
are preserved, and `config.toml` is not modified.

Native hooks are used instead of a filesystem watcher because Codex now
provides a session-end lifecycle event with a transcript path and session ID.
The hook snapshots the transcript in memory before returning, so archive/delete
cannot remove it before capture. A detached worker handles conversion, daemon
startup and ingestion outside Codex's three-second shutdown budget.
No prompting is required to capture a session.
Extraction must be configured as for
[ordinary ingestion](../../README.md#automatic-memory-capture).
Privacy policy and deduplication stay in the daemon.

Normal exit ends a session. Merely switching conversations does not;
an unopened conversation ends after 30 minutes idle. Null transcript paths
cannot be captured. The adapter supports the current rollout `response_item`
message format, not arbitrary JSONL exports. See the
[package README](../../packages/adapter-codex/README.md) for supported records,
restoration and failure behavior.

## MCP retrieval

Add this to the active Codex `config.toml`:

```toml
[mcp_servers.openmembrane]
command = "openmembrane"
args = ["mcp"]
```

Install the CLI globally if it is not already on PATH:

```sh
npm install -g openmembrane
```

The first MCP tool call starts the local daemon if needed. The installed
`AGENTS.md` section requests project rules and relevant context at session
start, but only when you explicitly allow stored-memory egress to the
configured model provider. Hook installation does not grant that permission.

Launch Codex from your project root. If overriding `OPENMEMBRANE_PROJECT_ID`,
`OPENMEMBRANE_HOME` or `OPENMEMBRANE_STORAGE_BACKEND`, set identical values
in Codex's launch environment and MCP configuration. An MCP server's `env`
table applies only to that server, not session hooks. Prefer an absolute
`OPENMEMBRANE_HOME` when sharing an override.

## Verify and troubleshoot

Finish a session containing durable project knowledge, then inspect
`openmembrane candidates list` or `openmembrane context`. Results may be
saved memories or pending candidates according to configured policy.
Capture uses `--tool codex` and the Codex session ID.

If capture is missing, check `/hooks` trust, feature flags and the
`openmembrane-capture.log` file under the Codex home directory, plus
`openmembrane status` and diagnostics. Detached failures are logged locally
without echoing transcript content into the conversation.

## Remove

```sh
npx @openmembrane/adapter-codex uninstall
```

Repeated install/uninstall is safe. Original unchanged files are restored,
later user edits are preserved, and the capture log is retained.
