# Contributing to OpenMembrane

## Prerequisites

- Node.js >= 18
- npm (included with Node.js)

## Setup

```sh
git clone https://github.com/mohamadalhusseinie/openmembrane.git
cd openmembrane
npm install
```

## Development

Run the MCP server locally (from source):

```sh
npm run mcp:stdio
```

Run tests and type checking:

```sh
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run check     # both (typecheck + test)
```

Build the publishable bundle:

```sh
npm run build
```

## Project Structure

See [Architecture](docs/architecture.md) for the package layout, dependency graph, and type schemas.

The daemon (`apps/daemon`) is the only process that writes storage. CLI, review UI, MCP server and adapters talk to it through `@openmembrane/client` and must not construct project services or stores. Storage imports (including relative and dynamic imports) are restricted to `packages/storage`, `packages/service`, `apps/daemon` and tests; `npm run check:storage-imports` enforces this. See [Daemon Protocol](docs/daemon-protocol.md).

## Code Style

- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- ESM (`"type": "module"`)
- Use `type` imports for type-only references
- No enums â€” use `as const` arrays with derived union types
- Explicit return types on exported functions
- One clear responsibility per file

## Pull Requests

1. Create a feature branch from `main`.
2. Make focused, incremental commits.
3. Ensure `npm run check` passes (typecheck + tests).
4. Open a PR with a clear description of the change.

### Documentation impact

Before implementing a ticket, read the relevant documentation and identify
affected documents in the implementation plan, or explain why none are affected.
Update those documents in the same PR and review the final diff for documentation
impact before marking the work complete. Keep current behavior separate from
planned features. The canonical agent workflow is in [AGENTS.md](AGENTS.md).

Every PR, including an automatically generated PR, must complete the template's
`Documentation impact` section. Select exactly one option and fill in `Details`
with updated document paths and an explanation, or a specific reason why no
documentation changes are necessary.
The release workflow adds a no-impact assessment to generated version PRs,
which only update package versions and release metadata/changelogs.

The `Documentation impact` CI check rejects missing assessments and requires a
documentation change when `Updated documentation` is selected. It recognizes
root Markdown files, Markdown/MDX files under `docs/`, and application/package
READMEs. Changesets and changelogs do not count. Reviewers must check that the
assessment and documentation are accurate; CI cannot establish semantic accuracy.

Repository maintainers should configure `Documentation impact` as a required
status check in the ruleset or branch protection for `main` after the workflow
is available. A workflow file alone does not prevent merging.

## Security

- Never commit secrets, credentials, API keys, or `.env` files.
- Memory candidates classified as `secret` must always be rejected.
- See [Security and Privacy](docs/security-and-privacy.md) for the full policy.
