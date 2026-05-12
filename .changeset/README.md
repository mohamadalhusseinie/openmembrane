# Changesets

This directory is managed by [@changesets/cli](https://github.com/changesets/changesets).

## Adding a changeset

When your PR includes user-facing changes, run:

```sh
npx changeset
```

This creates a markdown file in `.changeset/` describing the change and its version bump type (patch, minor, or major). Commit this file with your PR.

## How it works

All packages use **lockstep versioning** — a changeset for any package bumps the version of every package in the monorepo. Only the `openmembrain` MCP server package publishes to npm; internal `@openmembrain/*` packages are private.

See [docs/release.md](../docs/release.md) for the full release process.
