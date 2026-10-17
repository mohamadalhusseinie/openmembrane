# Local daemon protocol and client

`@openmembrane/protocol` defines the additive `/v1` HTTP contract.
`@openmembrane/client` supplies `OpenMembraneClient`; CLI data commands and
the review UI use it instead of opening storage. MCP still uses the
in-process service pending its separate migration. `apps/daemon` serves the contract via
the existing `OpenMembraneService`, with no HTTP framework dependency.

## Daemon lifecycle

The installed `openmembrane` executable provides:

| Command | Behavior |
| --- | --- |
| `serve` | Run the daemon in the foreground; SIGINT/SIGTERM initiate shutdown. |
| `start` | Start a detached daemon and wait for health readiness; an existing daemon is left running. |
| `status` | Report daemon availability; exit code 1 means it is not running. |
| `stop` | Request authenticated graceful shutdown and wait for lock cleanup. |
| `mcp`, or no arguments | Launch the existing MCP stdio server, unchanged. |

From the repository, `npm run start -w @openmembrane/daemon` runs the
foreground daemon. Start the daemon before using `ingest`, `context`,
management commands, or the review UI. These clients do not auto-launch
or fall back to local services. Do not use the in-process MCP surface and
the daemon to write the same project store concurrently.

## CLI and review UI operations

All CLI data commands accept `--project <id>` and
`--output text|json|markdown`. Ingest retains its JSON default; context and
management commands default to text. CLI failures exit nonzero and retain
the daemon's safe error code and diagnostic ID.
Caller opt-outs (`OPENMEMBRANE_EXTRACTION_ENABLED=false` or
`OPENMEMBRANE_EXTRACTION_PROVIDER=mock`) are carried to ingestion as
`extractionEnabled: false`. The service then uses its local mock extractor
for that request, even if the daemon has a remote provider configured.
Callers cannot enable extraction or forward provider credentials through
this field; remote provider configuration remains daemon-owned.

| Command | Client operation |
| --- | --- |
| `ingest --file <path>` or `ingest --stdin` | `ingest` (transcript parsing stays in the CLI) |
| `context [--query <query>] [--type <type>] [--scope <scope>]` | `getCliContext` |
| `candidates list [--limit <n>]` | `listMemoryCandidates` |
| `candidates approve <id>` / `reject <id> [--reason <text>]` | `approveMemoryCandidate` / `rejectMemoryCandidate` |
| `candidates approve-all` / `reject-all [--reason <text>]` | `approveAllCandidates` / `rejectAllCandidates` |
| `memory update <id> [--content <text>] [--type <type>] [--scope <scope>] [--tags <a,b>]` | `updateMemory` |
| `memory supersede <id> [--reason <text>] [--replacement-id <id>]` | `supersedeMemory` |
| `memory stale [--stale-after-months <n>]` | `reviewStaleMemories` |
| `export [--targets <a,b>] [--output-dir <path>] [--include-confidential] [--preview]` | `exportStaticMemoryFiles` |
| `diagnostics [--severity <level>] [--code <code>] [--limit <n>]` | `getDiagnostics` |
| `audit [--limit <n>]` | `listAuditLog` |
| `team configure --owner <owner> --repo <name> [--host <host>]` | `configureGitHubTeamMode` |
| `team status` | `getCollaborationStatus` |

The additive `POST /v1/context/cli` preserves the CLI's existing context
ranking, filters and untruncated results, with a full pending-candidate
count. If only the reminder lookup fails, the endpoint still returns the
memories with `pendingCandidateCount: null` and a safe `pendingReminderError`
(`code`, `safeMessage`, `diagnosticId`); the CLI prints context and warns on stderr
instead of hiding memories or implying an empty review queue.
`POST /v1/memories` preserves the UI's active-memory listing and
search behavior. Unfiltered listings without a limit include all active entries.
`GET /v1/memory/:id` returns a memory (including superseded entries) or
JSON `null`. Candidate requests accept `limit: null` for complete review
listings; existing omitted and numeric limits keep their previous meaning.
`POST /v1/export` accepts `preview: true` to render the same files using
the same confidentiality filters without writing anything.
`GET /v1/audit` accepts `order: "append"` for newest-appended-first
ordering before applying the limit. Omitted order (or `"timestamp"`) keeps
newest-timestamp-first ordering for existing callers.

The loopback review server binds one caller project and never forwards
browser-supplied project/storage routing overrides. Its API preserves
existing response shapes:

| Review UI route | Behavior |
| --- | --- |
| `GET /api/memories` | Active memories; `q`, `type`, `scope`, `limit` filters |
| `GET /api/memories/stale` | Stale review; optional `staleAfterMonths` |
| `GET /api/memories/:id` | Memory detail, or 404 |
| `PATCH /api/memories/:id` | Update content, type, scope, tags |
| `POST /api/memories/:id/supersede` | Supersede with optional reason/replacement ID |
| `GET /api/candidates` | Complete pending list |
| `POST /api/candidates/:id/approve` / `reject` | Individual review |
| `POST /api/candidates/approve-all` / `reject-all` | Bulk review; approval includes skipped IDs/reasons |
| `GET /api/audit` | Newest-appended audit entries, optional `limit` |
| `GET /api/diagnostics` | Diagnostics; `severity`, `code`, `limit` filters |
| `POST /api/export/preview` | Render only, regardless of a supplied preview flag |
| `POST /api/export` | Write generated files |

Browser errors use `{ error: "<safe message>", code, diagnosticId }`;
daemon diagnostic IDs and HTTP failure statuses are preserved. Invalid UI inputs are rejected
before proxying. Unavailable daemons produce HTTP 503, not empty success
responses. The daemon bearer token stays in the server process and is
never exposed to browser JavaScript.
Host and Origin validation reject cross-site browser requests and
non-loopback Host values before any daemon request is sent.

## Project routing and lifecycle guarantees

Project requests normalize their absolute root before validating the
directory or deriving the default ID from its basename. Dot and parent
segments therefore do not split memory visibility or bypass root-ID validation.
On Windows, request paths must include a drive and root separator or a UNC
server/share. Drive-dependent rooted paths such as `\project` are rejected
for both `projectRoot` and `storageDir` instead of using the daemon's drive.
Storage queue keys also resolve dot segments before filesystem canonicalization,
matching the service's storage resolution. A symlink followed by `..` cannot
give concurrent writers to the same store different serialization queues.
Project requests default their ID to the project directory's basename,
never to the daemon's environment. Filesystem-root projects (`/` or a
Windows drive root) require an explicit non-empty `projectId`; omission
returns a diagnostic-bearing validation error before storage is opened.

`daemon.lock` in the run directory records the PID, OS process-start identity, instance identifier,
and endpoint. Exclusive creation prevents concurrent instances, live
locks refuse another `serve`, and stale locks are reclaimed at startup.
Process-start identity distinguishes an unrelated process reusing an old
PID from the actual owner, even if the live daemon is slow or its listener
is closed for cleanup. POSIX `ps` lookups use the C locale and UTC timezone,
so callers with different timezone settings derive the same identity.
Recovery guards use the same identity.
Linux zombie and dead process states are treated as exited, even while the
PID and start ticks remain visible until the parent reaps the process.
Legacy
published locks without process-start identity use authenticated
`/v1/daemon/identity` verification; a timeout is indeterminate and fails
with `DAEMON_OWNERSHIP_UNCERTAIN` without reclaiming the lock.
Legacy unpublished live-PID locks and recovery guards are protected by
a ten-second startup grace period. `stop` likewise verifies ownership
instead of terminating a PID.
Incomplete locks are treated as a startup in progress for ten seconds.
`status` reports an invalid lock as unavailable and records a safe local
diagnostic; `start` still launches the recovery path, which reclaims an
old malformed lock but preserves the ten-second startup grace period.
The bearer token is randomly generated on each startup. Shutdown closes
the listener, drains requests and retrieval-triggered retry work, closes
all cached project stores, and removes the lock, token, endpoint file,
and socket. Before closing the listener, the instance holds the recovery
election until its discovery cleanup finishes. A concurrent restart cannot
publish replacement files that the stopping instance would then delete.
An instance that has already lost its lock does not remove shared discovery.
`stop` uses an authenticated `POST /v1/daemon/stop` lifecycle
endpoint with JSON `{ "instanceId": "<expected UUID>" }` rather than
process termination, including on Windows. A replacement rejects a stop
request for the old instance with `DAEMON_INSTANCE_MISMATCH`, even if the
caller read the replacement's token during the transition.

Logs live in `~/.openmembrane/logs/daemon.log`, independently of
`OPENMEMBRANE_HOME`. Logs contain lifecycle events, safe failure codes,
and diagnostic IDs, not tokens, request content, raw errors, or GitHub
command output. Detached startup has ignored stdio. Logs and discovery
directories have owner-only access: POSIX directory mode `0700` and file
mode `0600`, or a Windows DACL restricted to the current user's SID.
Atomic discovery replacement retries transient Windows `EPERM`/`EBUSY`
errors for at most 775 milliseconds; persistent errors fail startup with
`DAEMON_PRIVATE_PUBLICATION` rather than weakening file permissions.
Unexpected listener errors record `DAEMON_LISTENER_ERROR` with a diagnostic
ID, drain work and clean up discovery, then fail the foreground lifecycle
rather than reporting a successful shutdown. Raw listener error details
are not written to the log.
The listener-error handler is installed before listening and remains active
through discovery publication. Failures before readiness or during startup
publication reject startup only after cleanup; they do not leave an
uncaught listener error or stale discovery files. Project requests during
publication receive `DAEMON_STARTING` instead of starting work before the
daemon is ready.
Initialization after lock acquisition is also covered by cleanup: a service
or server-factory exception closes any initialized service and releases the
lock, allowing another startup in the same still-running host process.
If shutdown cannot acquire its recovery guard, it still closes the listener,
drains in-flight work, closes stores, and attempts lock release. Shared
discovery files are not explicitly deleted without ownership protection.
Cleanup failures are aggregated in memory and reported with the safe
`DAEMON_CLEANUP_ERROR` diagnostic rather than leaving a live, unusable listener.

The protocol's `endpoints` map is the source of truth for HTTP methods,
paths, request/response Zod schemas, and project scope. `EndpointRequest`
and `EndpointResponse` derive TypeScript types from that map. Responses
match the service's JSON results, including GitHub Team publication and
retry state. Errors use `{ error: { code, safeMessage, diagnosticId } }`.
Health returns `{}` with no project data and requires no token.

## Request encoding

POST and PATCH send the complete validated request as JSON. GET sends it
as a single URL-encoded `input` query parameter containing JSON, with no
request body. The daemon must JSON-decode `input` before validating the
request. Health has no query parameters.

For routes containing `:id`, the client URL-encodes `candidateId` or
`memoryId` from the request. The ID remains in the JSON request too;
the daemon must reject a mismatch between the decoded route ID and that
field. This keeps schemas aligned with existing service operation inputs.

Every project-scoped request requires an absolute `projectRoot`, with
optional `projectId`, absolute `storageDir`, and `storageBackend`
(`json` or `sqlite`). Path existence is the daemon's responsibility.
The client defaults `projectRoot` to the caller's cwd, forwards
`OPENMEMBRANE_PROJECT_ID` and `OPENMEMBRANE_STORAGE_BACKEND`, and resolves
`OPENMEMBRANE_HOME` relative to the caller's project root into `storageDir`.
Explicit per-call fields take precedence over environment defaults.
These fields must not be replaced by the daemon's cwd/environment.
The daemon rejects relative, nonexistent, and non-directory project
roots before opening stores. Requests sharing a storage directory are
serialized to protect JSON indexes; unrelated project stores can run
concurrently. Queue and store-cache keys use filesystem-canonical paths
so symlink and case-insensitive filesystem aliases share the same store.
Explicit backend selection participates in the store cache.

GitHub Team commands run as the same OS user with `cwd` set to the
request's project directory. The daemon neither reads nor stores GitHub
credentials; the user's existing `gh` authentication applies. Missing or
unauthenticated `gh` produces a safe error with a diagnostic ID without
stopping the daemon; diagnostics and candidate rejection remain usable.
Other publication failures retain durable retry state and the existing
publication result shapes. Eligible retries run after successful rules,
context, or search responses, with the existing backoff and no scheduled
timers. Shutdown also drains this post-response work.

## Shared per-user endpoint resolution

Both daemon and client must use `resolveDaemonPaths` and
`resolveDaemonEndpoint` from the protocol package:

| Platform | Run directory | Endpoint |
| --- | --- | --- |
| macOS/Linux | `$XDG_RUNTIME_DIR/openmembrane`, otherwise `~/.openmembrane/run` | `daemon.sock` Unix socket |
| Windows | `~\.openmembrane\run` | `endpoint.json` containing `{"transport":"tcp","host":"127.0.0.1","port":<ephemeral-port>}` |

The bearer token is read from `token` in the same run directory on each
authenticated request. `OPENMEMBRANE_HOME` controls project storage, not
daemon discovery. The daemon must create its socket, token, and run
directory with owner-only access. Windows endpoint files and explicit
client overrides accept only `127.0.0.1`, never a remote network address.

## Client usage

```ts
import { OpenMembraneClient, createDaemonAutoLaunch } from "@openmembrane/client";

const client = new OpenMembraneClient({
  // Optional: the daemon executable is supplied by the integrating surface.
  autoLaunch: createDaemonAutoLaunch(process.execPath, [daemonEntryPoint, "serve"]),
});
await client.remember({ content: "Use standalone Angular components.", type: "coding_rule" });
const context = await client.getRelevantContext({ query: "Angular components" });
```

Named methods mirror the endpoint map; `client.call(name, input)` also
provides typed access to every operation. Endpoint/path, environment,
project-root, and timeout options support embedding and tests.

With no auto-launch hook, unavailable endpoints raise
`OpenMembraneClientError` with code `E_DAEMON_NOT_RUNNING`.
An opt-in hook starts a detached process with ignored stdio; the client
polls unauthenticated `/v1/health`, re-resolves the endpoint, and retries
after readiness. Concurrent startup attempts on one client share a
promise; cross-process single-instance coordination belongs to the daemon.
Default startup timeout is 10 seconds, poll interval 100 ms, and request
timeout 30 seconds. Request bodies are not replayed after timeouts or
connection resets because a mutation might already have been applied.

Token failures, malformed responses, and transport failures have distinct
client error codes. Remote safe errors retain their code, safe message,
diagnostic ID, and HTTP failure `status`; they do not trigger auto-launch.
