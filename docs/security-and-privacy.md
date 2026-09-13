# Security And Privacy

OpenMembrane is a protective memory layer. It should persist durable project knowledge while blocking secrets, credentials, raw sensitive data, and temporary debugging noise.

## Principles

- local-first by default
- no cloud required for the MVP
- no account required for the MVP
- no raw full conversation storage by default
- no raw source code storage by default
- no secrets persisted
- no credentials persisted
- saved memory should be inspectable by the developer
- external LLM usage must be explicit and policy-controlled
- stored memory should not be sent to external model providers unless explicitly configured

## Local Private

The current release ships Local Private mode. It stores data locally in JSON
files under `.openmembrane` by default, and that directory is git-ignored.

The local store may contain:

- saved memory entries
- pending candidates
- audit events
- diagnostics events

The local store should not contain:

- raw full conversation history by default
- raw source code by default
- credentials
- API keys
- private keys
- raw database URLs
- access tokens

## Secret And Sensitive Data Handling

Rule-based filters should detect:

- API keys
- passwords
- tokens
- private keys
- database URLs
- `.env`-like secrets
- JWTs
- GitHub tokens
- cloud access keys

Detected secrets should be redacted or blocked before memory extraction and before persistence.

Candidates classified as `secret` must be rejected. Secret candidates must not be approvable.

## Noise Handling

OpenMembrane should reject:

- temporary stack traces
- temporary logs
- large raw code blocks
- raw source code snippets
- failed debugging attempts without durable lessons
- unverified guesses
- generic programming advice
- emotional commentary

## Audit Events Vs Diagnostics

Audit events describe normal memory lifecycle activity. Diagnostics describe operational problems. See [Architecture](architecture.md#audit-and-diagnostic-schemas) for the full schema definitions and event type values.

MCP tools should return safe user-facing errors with a diagnostic ID. Detailed diagnostics should be inspectable locally without exposing raw transcripts or secrets.

## External LLM Usage

The primary memory path (`remember` tool) does not call external LLM providers. The AI tool itself performs extraction and provides structured content directly.

The secondary path (`propose_memory_from_session`) uses an external LLM when a provider is explicitly configured. Provider-backed extractors must follow these rules:

- no external model use unless explicitly configured
- redact secrets before provider calls
- do not persist raw full conversations by default
- log provider failures as diagnostics
- keep provider implementations behind `MemoryExtractor`
- support local model extractors where possible

## Deployment-Mode Positioning

Do not claim "everything is 100% secure" or "no data is ever shared" in vague terms.

Correct positioning:

- Local Private is the current default and keeps the local store in git-ignored
  `.openmembrane/`.
- GitHub Team is a current mode with initial limitations. It syncs only accepted
  memory through the selected dedicated private repository; pending candidates,
  raw transcripts, source excerpts, diagnostics, and credentials do not sync.
- Self-Hosted Team and Managed Team are planned, not current product features.
- External LLM usage must be explicit and policy-controlled.
- Stored memory should not be sent to external model providers unless explicitly configured.

See [Deployment Modes](deployment-modes.md) for the canonical description of
ownership, GitHub authentication and pull-request lifecycle, static exports,
and residency language.

## Future Hosted Requirements

Planned Self-Hosted Team and Managed Team modes should support:

- encryption
- tenant isolation
- audit logs
- policy controls
- data residency controls
- self-hosting
- explicit external LLM configuration

These are not part of the MVP.
