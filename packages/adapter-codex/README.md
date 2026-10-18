# OpenMembrane Codex adapter

Automatic session capture for Codex, with no memory policy in the adapter.
Requires Node.js >= 18 and a Codex release supporting native `SessionEnd`
command hooks and rollout JSONL transcripts.

```sh
npx @openmembrane/adapter-codex install
```

Restart Codex and use `/hooks` to review and trust the installed hook. Hooks
must be enabled (`features.hooks` must not be false). Installation does not
bypass hook trust, enable disabled hooks, or change managed policy.

## Why hooks, not a watcher?

The [Codex hooks guide](https://developers.openai.com/codex/hooks/) and
[config reference](https://developers.openai.com/codex/config-reference/)
document native `SessionEnd` hooks (verified October 2026). Hooks avoid a
second long-running watcher, filesystem polling and a local dedup database.
The handler receives `session_id`, `cwd` and `transcript_path` on stdin.
`SessionEnd` runs on normal exit, archive/delete of an open conversation, or
after an unopened conversation has been idle for 30 minutes; switching tabs
does not immediately end a session. Older Codex releases without these hooks
are unsupported; upgrade rather than expecting a watcher fallback.

The installer preserves existing `hooks.json` configuration and adds a marked
retrieval section to `AGENTS.md` under `$CODEX_HOME` (default `~/.codex`).
It never modifies `config.toml`. Repeated install/uninstall is idempotent.
Windows hooks explicitly invoke PowerShell with encoded, literal arguments;
POSIX hooks quote each argument. Paths with spaces or shell metacharacters
are supported.

Within the three-second `SessionEnd` limit, the hook reads a stable in-memory
snapshot before handing it to a detached worker. Codex can remove the rollout
immediately after the hook returns. The worker converts `response_item` user/assistant message
text, excludes reasoning, tool output, system/developer instructions and
duplicate `event_msg` records, starts the daemon, and pipes text to:

```text
openmembrane ingest --stdin --tool codex --format text --session-id <id>
```

Codex's rollout format is not a stable public hook contract; incompatible or
malformed message records fail explicitly. Sessions without a transcript
(`transcript_path: null`, e.g. ephemeral sessions) cannot be captured and report
a hook failure. No raw transcripts are copied or persisted by the adapter.
The core redacts the complete transcript before preparing bounded sequential
requests. The daemon owns extraction, classification, privacy policy and
deduplication. Stable session IDs preserve source identity and rejection
decisions when the same session is captured again.

The worker uses the hook's absolute `cwd` for project resolution. Launch Codex
from the project root and keep `OPENMEMBRANE_PROJECT_ID`, `OPENMEMBRANE_HOME`
and `OPENMEMBRANE_STORAGE_BACKEND` consistent between the Codex launch
environment, MCP configuration and other clients. MCP-only environment
settings are not inherited by hooks.

Capture failures never echo transcripts or provider errors into Codex.
Background failures appear in `$CODEX_HOME/openmembrane-capture.log`; check
`openmembrane status` and diagnostics before retrying ingestion. The package
includes the OpenMembrane CLI dependency; keep its installation/npx cache
available or reinstall after clearing it.

## Retrieval

The marked instructions request `get_project_rules`, `get_relevant_context`
and pending-candidate review at startup when MCP tools are available.
Installation neither configures MCP nor authorizes stored-memory egress to
a model provider. Configure MCP separately and explicitly allow memory egress
before retrieval; see [Codex setup](../../docs/setup/codex.md).

## Uninstall

```sh
npx @openmembrane/adapter-codex uninstall
```

Unchanged files are restored byte-for-byte (newly created ones are removed).
If files were edited after installation, only the adapter-owned hooks and
marked instruction block are removed. Deleted files stay deleted. The copied
runtime and installer state are removed; the diagnostic log is retained.
Malformed settings or ambiguous instruction markers abort before files change.
