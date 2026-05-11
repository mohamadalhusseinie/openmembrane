# Contributing to OpenMembrain

## Prerequisites

- Node.js >= 18
- npm (included with Node.js)

## Setup

```sh
git clone https://github.com/mohamadalhusseinie/openmembrain.git
cd openmembrain
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

## Code Style

- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- ESM (`"type": "module"`)
- Use `type` imports for type-only references
- No enums — use `as const` arrays with derived union types
- Explicit return types on exported functions
- One clear responsibility per file

## Pull Requests

1. Create a feature branch from `main`.
2. Make focused, incremental commits.
3. Ensure `npm run check` passes (typecheck + tests).
4. Open a PR with a clear description of the change.

## Security

- Never commit secrets, credentials, API keys, or `.env` files.
- Memory candidates classified as `secret` must always be rejected.
- See [Security and Privacy](docs/security-and-privacy.md) for the full policy.
