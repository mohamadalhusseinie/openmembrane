# Security And Privacy

OpenMembrain is a protective memory layer. It should persist durable project knowledge while blocking secrets, credentials, raw sensitive data, and temporary debugging noise.

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

## Local-Only MVP

The current MVP stores data locally in JSON files under `.openmembrain` by default.

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

OpenMembrain should reject:

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

The MVP does not call external LLM providers.

Future provider-backed extractors must follow these rules:

- no external model use unless explicitly configured
- redact secrets before provider calls
- do not persist raw full conversations by default
- log provider failures as diagnostics
- keep provider implementations behind `MemoryExtractor`
- support local model extractors where possible

## CH/EU Security Positioning

Do not claim "everything is 100% secure" or "no data is ever shared" in vague terms.

Correct future positioning:

- Local-only mode: all memory stays on the developer machine.
- CH/EU sync mode: encrypted memory can be synced to CH/EU-hosted infrastructure.
- Self-hosted mode: companies can run OpenMembrain inside their own infrastructure.
- External LLM usage must be explicit and policy-controlled.
- Stored memory should not be sent to external model providers unless explicitly configured.

## Future Hosted Requirements

Hosted and enterprise modes should support:

- encryption
- tenant isolation
- audit logs
- policy controls
- data residency controls
- self-hosting
- explicit external LLM configuration

These are not part of the MVP.
