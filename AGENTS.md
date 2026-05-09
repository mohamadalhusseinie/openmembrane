# AGENTS.md

Project context for AI coding tools working on the OpenMembrain codebase.

## Project Overview

OpenMembrain is a local-first, private, tool-agnostic memory layer for AI coding tools. It extracts durable project knowledge from session transcripts, filters out secrets and noise, and persists approved memories for future AI sessions.

## Architecture

### Pipeline

```
session transcript
  -> secret redaction
  -> memory extraction
  -> classification
  -> policy / safety / noise filtering
  -> deduplication
  -> conflict detection
  -> action recommendation (auto_save / ask_user / reject)
  -> memory store or pending candidate queue
```

### Monorepo Structure

```
packages/core/       — Domain types, extraction interface, pipeline orchestration,
                       classification, policy, deduplication, conflict detection
packages/storage/    — Local JSON persistence (memories, pending candidates, audit, diagnostics)
packages/exporters/  — Static fallback file generation (AGENTS.md, CLAUDE.md, etc.)
packages/shared/     — IDs, time helpers, generic result types
apps/mcp-server/     — MCP server (tool registration, validation, error responses)
tests/               — All test files (unit and integration)
```

Packages are imported via path aliases: `@openmembrain/core`, `@openmembrain/storage`, `@openmembrain/exporters`, `@openmembrain/shared`.

### Extractor Boundary

LLM integration stays behind an interface. The core must not hardwire a single provider.

```ts
interface MemoryExtractor {
  extract(input: SessionInput): Promise<MemoryCandidate[]>;
}
```

## TypeScript Conventions

- **Target:** ES2022, ESM (`"type": "module"` in package.json)
- **Strict mode** with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` enabled
- Use `type` imports for type-only references (`import type { ... }`)
- No enums — use `as const` arrays with derived union types (see `MemoryCandidate.ts` for examples)
- Prefer explicit return types on exported functions
- Use `readonly` for class fields that are set once in the constructor

## Testing

- **Framework:** Vitest
- **Run tests:** `npm test` (runs `vitest run`)
- **Run typecheck + tests:** `npm run check`
- **Test location:** `tests/unit/` for unit tests, `tests/` root for integration tests
- **Test helpers:** `tests/unit/helpers.ts` provides `candidate()` and `entry()` factory functions with `Partial<>` overrides
- Test files follow the naming convention `<Subject>.test.ts`
- Write tests that verify behavior, not implementation details

## Security and Privacy

- **No secrets persisted.** Secrets are redacted before extraction and before persistence.
- Candidates classified as `secret` sensitivity are always rejected and must not be approvable.
- Local-first by default — no cloud, no account required for the MVP.
- No raw full conversation or source code storage by default.
- External LLM usage must be explicit and policy-controlled.
- Stored memory must not be sent to external providers unless explicitly configured.
- Exporters exclude `confidential` memories by default (generated files may be committed to source control).

## Coding Rules

- Follow existing patterns in the codebase. Check neighboring files before introducing new patterns.
- Adapters and integrations must stay thin — no memory policy logic in adapters.
- MCP tools return safe user-facing errors with a diagnostic ID. Detailed diagnostics are stored locally.
- Keep files focused — one clear responsibility per file.
- DRY, YAGNI. Do not add features or abstractions that are not needed yet.
