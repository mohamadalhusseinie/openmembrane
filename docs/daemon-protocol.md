# Local daemon protocol and client

`@openmembrane/protocol` defines the additive `/v1` HTTP contract.
`@openmembrane/client` supplies `OpenMembraneClient`; existing MCP, CLI, and
review UI surfaces still use the in-process service. This change does not
switch those production consumers. `apps/daemon` serves the contract via
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
foreground daemon. MCP, `ingest`, `context`, and the review UI are not
daemon clients in this release. Do not use those in-process surfaces and
the daemon to write the same project store concurrently; switching them
to the daemon is separate follow-up work.

`daemon.lock` in the run directory records the PID, instance identifier,
and endpoint. Exclusive creation prevents concurrent instances, live
locks refuse another `serve`, and stale locks are reclaimed at startup.
Published locks are checked using an authenticated `/v1/daemon/identity`
response matching the recorded instance ID, not PID existence alone:
an unrelated process reusing an old PID does not prevent recovery.
Unpublished live-PID locks are protected by the ten-second startup grace
period. `stop` likewise verifies ownership instead of terminating a PID.
Incomplete locks are treated as a startup in progress for ten seconds.
`status` reports an invalid lock as unavailable and records a safe local
diagnostic; `start` still launches the recovery path, which reclaims an
old malformed lock but preserves the ten-second startup grace period.
The bearer token is randomly generated on each startup. Shutdown closes
the listener, drains requests and retrieval-triggered retry work, closes
all cached project stores, and removes the lock, token, endpoint file,
and socket. `stop` uses an authenticated `POST /v1/daemon/stop` lifecycle
endpoint rather than process termination, including on Windows.

Logs live in `~/.openmembrane/logs/daemon.log`, independently of
`OPENMEMBRANE_HOME`. Logs contain lifecycle events, safe failure codes,
and diagnostic IDs, not tokens, request content, raw errors, or GitHub
command output. Detached startup has ignored stdio. Logs and discovery
directories have owner-only access: POSIX directory mode `0700` and file
mode `0600`, or a Windows DACL restricted to the current user's SID.
Unexpected listener errors record `DAEMON_LISTENER_ERROR` with a diagnostic
ID, drain work and clean up discovery, then fail the foreground lifecycle
rather than reporting a successful shutdown. Raw listener error details
are not written to the log.

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
and diagnostic ID; they do not trigger auto-launch.
