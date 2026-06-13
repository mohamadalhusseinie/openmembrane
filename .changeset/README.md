# Changesets

This directory is managed by [@changesets/cli](https://github.com/changesets/changesets).

Changeset files are created automatically — you do not need to run `npx changeset` manually.

- **OpenCode** creates a changeset as part of the PR workflow (per AGENTS.md instructions).
- **If missing**, the `changeset-fallback` GitHub Action generates one from the PR title using conventional commit prefixes (`fix:` → patch, `feat:` → minor, `feat!:` → major).
- **CI-only or docs-only PRs** do not get changesets (the fallback workflow skips them via path filtering).

All packages use **lockstep versioning** — a changeset for any package bumps the version of every package in the monorepo. Only the `openmembrane` MCP server package publishes to npm; internal `@openmembrane/*` packages are private.

See [docs/release.md](../docs/release.md) for the full release process.
