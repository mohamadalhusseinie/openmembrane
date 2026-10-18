# OpenMembrane adapter for OpenCode

The reference adapter automatically loads project memory and submits completed
OpenCode conversations to the local OpenMembrane daemon. No MCP instructions or
manual `remember` calls are required.

## Install

Requires Node.js 18+ and OpenCode with the plugin API described below. Add the
package to your project `opencode.json` or global
`~/.config/opencode/opencode.json`, preserving your existing settings:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@openmembrane/adapter-opencode"]
}
```

Restart OpenCode. OpenCode installs the npm plugin and its dependencies,
including the `openmembrane` CLI peer dependency. The plugin reuses the local
daemon or auto-starts that CLI with `node <cli-entry> serve` on the first memory
request. Node must be on PATH; OpenCode's standalone executable is not used as a
JavaScript runtime. It uses
`@openmembrane/client` for authentication, endpoint discovery, and all memory
operations; it does not import services or storage.

For development, run `npm ci` and `npm run build` in this repository, then add
`"file:///absolute/path/to/openmembrane/packages/adapter-opencode/dist/index.js"`
to the plugin array instead. On Windows use a `file:///C:/...` URL.

## Extraction and verification

The default local extractor recognizes explicit rules and simple durable project
statements. To extract knowledge from arbitrary prose, configure the daemon's
extractor explicitly before it starts (see [setup](../../docs/setup/opencode.md)).
An existing daemon keeps its startup environment.

Use OpenCode normally: discuss a durable project constraint and let the response
finish. At idle, the plugin submits the session automatically. In the same project
directory, inspect `openmembrane context` and `openmembrane candidates list`.
The daemon decides whether to save, queue, or reject knowledge.
A conversation with no durable knowledge may legitimately produce no memories.
On the next model request, stored rules and relevant memories are appended to
the system context.

## Verified OpenCode API

Verified against the published **`@opencode-ai/plugin@1.19.3`** declarations and
its matching **`@opencode-ai/sdk@1.19.3`** declarations at implementation time:

- [Plugin types](https://unpkg.com/@opencode-ai/plugin@1.19.3/dist/index.d.ts)
  and [SDK types](https://unpkg.com/@opencode-ai/sdk@1.19.3/dist/gen/types.gen.d.ts).
- [Official plugin documentation](https://opencode.ai/docs/plugins/).
- The module exports exactly one default `Plugin` function. OpenCode passes
  `directory` (cwd) and its SDK `client` and receives a `Hooks` object.
- `experimental.chat.system.transform({ sessionID, model }, { system })` runs
  before a model request. The plugin reads rules and context from the daemon
  and concatenates memory into the last existing `system` entry (or creates one
  if empty), preserving the host prompt and system-message count for providers
  that accept only one leading system message. This also covers resumed
  sessions; `session.created` alone would not. Requests without a session ID
  (for example, auxiliary model calls) are left untouched. This experimental
  hook should be checked when upgrading OpenCode.
  Retrieval requests at most 10 rules and 5 relevant memories. Whole entries are
  included only while they fit a conservative UTF-8 byte budget: 10% of the
  model context, capped at 8,000 bytes, with space reserved for the existing
  system text and configured model output. This is prompt-size management,
  not memory classification or save policy.
- `client.session.messages({ path: { id: sessionID }, query: { directory } })`
  returns `{ data: [{ info, parts }], error? }`. User and assistant **text parts**
  are serialized in order as `role: text`. Binary attachments, reasoning, tool
  payloads, and bookkeeping parts are not conversation text and are not included.
  The latest user text is the relevance query, falling back to the project name.
- `event({ event: { type: "session.idle", properties: { sessionID } } })`
  triggers `POST /v1/ingest` via the client with `tool: "opencode"`, `sessionId`,
  and the transcript. There is no documented `session.ended` event: idle is the
  completion boundary, not deletion. `session.deleted` clears session state;
  `dispose` stops accepting new work and waits for in-flight ingestion,
  including requests belonging to deleted sessions. Abrupt process termination cannot
  guarantee delivery.
- Ingestion is serialized per session. Identical successful snapshots are not
  resubmitted within the plugin lifetime; changed snapshots are submitted in
  full, leaving memory deduplication to the daemon. Failed submissions can retry
  on the next idle event. Only a digest is retained, never a transcript file.
- Errors are logged with `client.app.log({ body: { service, level, message,
  extra } })`; a failed logging endpoint falls back to stderr. The plugin does
  not throw daemon/startup errors into OpenCode or log conversation contents.

## Project routing and privacy

`directory` supplies the project root (falling back to process cwd). The cwd
basename supplies the default project ID; when it has no name (a filesystem
root), the origin git remote's repository name is tried. An explicit
`OPENMEMBRANE_PROJECT_ID` overrides the detected ID, consistently with the CLI.
`OPENMEMBRANE_HOME` and `OPENMEMBRANE_STORAGE_BACKEND` are handled by the client.
Use the same cwd and environment as your other OpenMembrane clients.

This adapter has no classification, filtering, redaction, or approval policy.
All such decisions belong to the daemon. Local Private is the default; external
extraction requires explicit configuration. The client enforces the daemon's
transcript size limit; oversized sessions are logged as failures, not silently
truncated or marked delivered.

## Uninstall

Remove `@openmembrane/adapter-opencode` (or its development file URL) from the
`plugin` array and restart OpenCode. Remove any local wrapper you installed.
This stops automatic capture and injection; it does not delete stored memories,
uninstall the CLI, stop a shared daemon, or remove separately configured MCP tools.
