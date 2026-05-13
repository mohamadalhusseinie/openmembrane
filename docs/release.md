# Release Process

OpenMemBrain uses [Changesets](https://github.com/changesets/changesets) for version management and releases.

## Versioning Strategy

All packages use **lockstep versioning** — when any package changes, every package in the monorepo gets the same version bump. This keeps versions consistent across the tightly-coupled `@openmembrain/*` packages.

Only the `openmembrain` package (the MCP server in `apps/mcp-server/`) publishes to npm. The internal `@openmembrain/core`, `@openmembrain/storage`, `@openmembrain/exporters`, and `@openmembrain/shared` packages are private.

## Adding a Changeset

When your PR includes user-facing changes, create a changeset:

```sh
npx changeset
```

This prompts you to:
1. Select which packages are affected (select any — lockstep bumps them all)
2. Choose a bump type:
   - **patch** — bug fixes, internal improvements
   - **minor** — new features, new MCP tools, non-breaking API changes
   - **major** — breaking changes to MCP tool schemas or storage format
3. Write a summary of the change

This creates a markdown file in `.changeset/`. Commit it with your PR.

Not every PR needs a changeset. Skip it for:
- Documentation-only changes
- CI/tooling changes
- Test-only changes
- Refactoring with no user-facing effect

## Automated Release Flow

The release process is fully automated via GitHub Actions (`.github/workflows/release.yml`):

1. **PR merged to `main` with changesets** — the Changesets GitHub Action detects pending changesets and creates (or updates) a "Version Packages" PR. This PR bumps version numbers in all `package.json` files and updates changelogs.

2. **"Version Packages" PR merged** — the action runs `npm run release` (`changeset publish`), which publishes the `openmembrain` package to npm and creates a GitHub release.

```
feature PR (with changeset) → main
  → Changesets Action creates "Version Packages" PR
    → merge that PR → publish to npm + GitHub release
```

## Manual Release (Fallback)

If you need to release manually:

```sh
# 1. Bump versions and update changelogs
npm run version-packages

# 2. Review the changes, then commit
git add .
git commit -m "chore: version packages"

# 3. Publish to npm (only non-private packages)
npm run release
```

## Setting Up NPM_TOKEN

For automated publishing, add an `NPM_TOKEN` secret to the GitHub repository:

1. Generate a token at [npmjs.com](https://www.npmjs.com/) → Access Tokens → Generate New Token (Granular Access Token recommended)
2. Grant the token publish access to the `openmembrain` package
3. In the GitHub repository, go to Settings → Secrets and variables → Actions
4. Add a new repository secret named `NPM_TOKEN` with the token value

The `GITHUB_TOKEN` is provided automatically by GitHub Actions.

## Package Overview

| Package | npm Name | Published |
|---------|----------|-----------|
| `apps/mcp-server` | `openmembrain` | Yes |
| `packages/core` | `@openmembrain/core` | No (private) |
| `packages/storage` | `@openmembrain/storage` | No (private) |
| `packages/exporters` | `@openmembrain/exporters` | No (private) |
| `packages/shared` | `@openmembrain/shared` | No (private) |
