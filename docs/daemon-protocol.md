# Local daemon protocol and client

`@openmembrane/protocol` defines the additive `/v1` HTTP contract.
`@openmembrane/client` supplies `OpenMembraneClient`; existing MCP, CLI, and
review UI surfaces still use the in-process service. This change does not
ship a daemon or switch production consumers.

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
