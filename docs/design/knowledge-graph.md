# Knowledge Graph Design

## Summary

Add a local-first Knowledge Graph to the existing Review UI. It will help users
explore how saved memories, pending candidates, lifecycle events, diagnostics,
and privacy-safe provenance relate to one another. The initial experience is a
2D graph and list fallback. An optional 3D view follows only after provenance,
manual editing, and performance, privacy, and accessibility hardening validate
that workflow.

The feature is delivered as a sequence of small issues under parent epic
[#142](https://github.com/mohamadalhusseinie/openmembrane/issues/142) rather
than one large change. The first release target is smooth interaction with up
to 500 entities on a typical developer machine.

## Goals

- Let users discover related project knowledge through a visual graph.
- Explain provenance and lifecycle without storing raw session transcripts.
- Infer conservative, explainable relationships locally.
- Let users correct inferred relationships with audited manual changes.
- Keep 2D and list-based workflows fully functional; 3D is optional.

## Non-Goals

- Persisting complete AI conversation transcripts.
- Automatically changing memory approval, rejection, merge, or supersession
  state because of a graph relationship.
- Hosted graph storage, accounts, or cloud processing.
- Supporting more than 500 returned entities in the initial release.

## Entities And Privacy

The graph is scoped to a project and can represent these node categories:

- Active and superseded saved memories.
- Pending memory candidates.
- Audit events and diagnostics relevant to represented memory lifecycle.
- Privacy-safe source-session summaries.
- Metadata groupings for tags, scopes, and memory types.

Session nodes expose only data that OpenMembrane already stores on a memory
source: tool, session identifier, and a saved short excerpt where one is
available. Any displayed time is labeled as the memory or candidate extraction
or persistence time; current storage does not provide the actual source-session
date. A missing session identifier is represented by a privacy-safe
unknown-source grouping. The feature must not introduce complete transcript
storage.

Secret candidates, secret-like strings, and secrets detected by existing safety
checks are excluded from graph nodes, edges, inference input, API payloads, and
exports. Confidential content follows existing local-access policy and must be
excluded from generated static exports by default.

## Relationship Model

Add a durable local relationship record with:

- Stable identifier and project identifier.
- Source and target entity references, each with entity kind and identifier.
- Relationship type: `related_to`, `supports`, `depends_on`, `conflicts_with`,
  `duplicate_of`, `supersedes`, `derived_from`, or `tagged_with`.
- Origin: `inferred`, `manual`, or `derived`.
- Confidence and human-readable rationale.
- Created, updated, and removed lifecycle timestamps/status.

Existing duplicate metadata is projected as a `duplicate_of` relationship with
`derived` origin. Other conflict, supersession, source-session, tag, scope,
type, audit, and diagnostic metadata are represented as `derived`
relationships or graph nodes as appropriate. Persisted manual relationships
must remain separate from inferred and derived relationships. A manual
relationship or removal overrides a conflicting inference without deleting the
underlying inferred evidence.

Creating, removing, or overriding a manual relationship writes an audit event.
Graph relationships are informative only and never trigger destructive memory
actions.

## Local Relationship Inference

Inference runs locally when graph data is refreshed or affected records change.
It uses deterministic, conservative signals:

- Shared tags.
- Compatible scope and memory type.
- Shared saved source-session identifiers.
- Existing duplicate, conflict, and supersession metadata.
- Bounded text similarity.

Each inferred relationship includes evidence, such as the shared tags or
matching session identifier, and a confidence value. Low-confidence text-only
matches are not persisted or returned by default. Inference is deduplicated,
bounded for the 500-entity target, and deterministic for identical inputs.

## Review UI And API

Add a Knowledge Graph view to `apps/review-ui`, served by the existing
`npm run review-ui` command. The project-scoped service owns all graph reads
and mutations. Those operations are exposed through the daemon protocol and
`@openmembrane/client`; the Review UI consumes that client and must not access
relationship storage directly. The graph APIs return bounded, redacted nodes
and edges plus filterable entity details.

The initial 2D view supports:

- Search and filters by node and relationship type.
- Pan, zoom, node selection, and focus on a selected node's immediate
  neighborhood.
- A node inspector showing details, relationship rationale, confidence, origin,
  and existing review actions where applicable.
- A legend that distinguishes entity categories and inferred, manual, and
  derived relationships.
- A list/table fallback for non-spatial navigation.
- Clear empty, loading, validation-error, and server-failure states.

The API rejects malformed filters, invalid entity or relationship types, missing
entities, and requests over the configured entity limit with safe user-facing
errors. Default graph responses contain at most 500 entities.

## Optional 3D Mode

Only after the 2D/list experience, provenance overlays, manual editing, and
performance, privacy, and accessibility hardening are complete, add a 3D mode
that consumes the same daemon-backed graph API and filters. It provides camera
controls, hover and selection, focus mode, and a direct return to 2D. It is an
optional exploration mode, not the only supported interface.

The 3D mode also respects the reduced-motion preferences already supported by
the 2D/list workflow. The 2D and list workflows remain available for
accessibility and devices unsuitable for 3D rendering.

## Delivery Issues

These delivery issues are tracked by parent epic
[#142](https://github.com/mohamadalhusseinie/openmembrane/issues/142).

### 1. Define And Persist Typed Memory-Graph Relationships

- Add relationship domain types, local storage, migration support, core APIs,
  lifecycle behavior, and audit events.
- Cover all initial relationship types, including `duplicate_of`, and entity
  references.
- Support `inferred`, `manual`, and `derived` relationship origins, with
  projected existing metadata marked as `derived`.
- Verify secret content cannot enter relationship records.

### 2. Build Deterministic Relationship Inference

- Derive bounded, explainable inferred links from approved signals.
- Persist rationale and confidence.
- Deduplicate results and omit low-confidence text-only relationships.

### 3. Add Knowledge Graph API To Review UI

- Add project-scoped graph operations to the service, daemon protocol, and
  `@openmembrane/client`.
- Have Review UI routes delegate through the client without direct storage
  access.
- Return safe, bounded project graph payloads and entity details.
- Include privacy-safe session nodes and saved excerpts only when present.
- Add filters, search, input validation, and redaction coverage.

### 4. Create A 2D Knowledge Graph Exploration View

- Add the Knowledge Graph navigation entry and 2D graph interaction.
- Add filtering, search, inspector, focus mode, legend, and list fallback.

### 5. Add Provenance And Lifecycle Overlays

- Show safe source-session paths, source excerpts, candidate approval paths,
  duplicates, conflicts, supersession chains, audit events, and diagnostics.
- Make inferred, manual, and derived relationships visually distinct.

### 6. Add Manual Relationship Review And Editing

- Allow users to create, remove, and override relationships.
- Preserve inference evidence independently and give manual decisions priority.
- Require a rationale for conflict and supersession corrections.

### 7. Harden Performance, Privacy, And Accessibility

- Verify smooth interaction with a representative 500-entity fixture.
- Add bounded expansion and pagination behavior, keyboard controls,
  reduced-motion behavior, export exclusions, and accessible fallback coverage.
- Verify no raw transcript retention or secret exposure.

### 8. Add Optional 3D Knowledge Graph Mode

- Reuse the daemon-backed graph API and 2D controls in a 3D renderer.
- Add camera, focus, hover/selection, reduced-motion behavior, and 2D return.
- Start only after the hardened 2D/list workflow is complete.

## Testing

- Unit tests for relationship persistence, lifecycle, validation, and audit
  logging.
- Tests for all relationship origins and projection of existing metadata as
  `derived`.
- Deterministic inference tests covering evidence, confidence, deduplication,
  limits, and excluded low-confidence matches.
- Tests proving manual edits override inferred links without destroying evidence.
- API tests for redaction, limit enforcement, filtering, invalid requests, and
  privacy-safe session representation.
- Review UI tests for filters, selection, inspectors, list fallback, empty and
  failure states, and reduced-motion behavior.
- A representative 500-entity fixture for interaction and performance checks.

## Dependencies And Sequencing

Issues 1 through 4 establish the usable 2D/list exploration workflow. Issues 5
and 6 add provenance overlays and manual relationship management and may
proceed independently after issue 4. Issue 7 closes performance, privacy, and
accessibility gaps across that complete 2D/list workflow. Optional 3D is issue 8
and starts only after issue 7 is complete.
