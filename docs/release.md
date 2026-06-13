# Release Process

OpenMembrane uses [Changesets](https://github.com/changesets/changesets) for version management and releases.

## Versioning Strategy

All packages use **lockstep versioning** — when any package changes, every package in the monorepo gets the same version bump. This keeps versions consistent across the tightly-coupled `@openmembrane/*` packages.

Only the `openmembrane` package (the MCP server in `apps/mcp-server/`) publishes to npm. The internal `@openmembrane/core`, `@openmembrane/storage`, `@openmembrane/exporters`, and `@openmembrane/shared` packages are private.

## How Changesets Are Created

Changeset files are created automatically — you do not need to run `npx changeset` manually.

- **OpenCode** creates a `.changeset/<name>.md` file as part of the PR workflow (per AGENTS.md instructions).
- **If missing**, the `changeset-fallback` GitHub Action (`.github/workflows/changeset-fallback.yml`) generates one from the PR title using conventional commit prefixes:
  - `fix:`, `chore:`, `docs:`, `refactor:` etc. → **patch**
  - `feat:` → **minor**
  - `feat!:` or `BREAKING CHANGE` in PR body → **major**

The fallback workflow only runs when the PR changes files that affect the published package. CI-only, docs-only, and workflow-only PRs are skipped (no changeset, no release).

Not every PR needs a changeset. Skip it for:
- Documentation-only changes
- CI/tooling changes
- Test-only changes
- Refactoring with no user-facing effect

## Automated Release Flow

The release process is fully automated via GitHub Actions:

1. **PR merged to `main` with changesets** — the Changesets GitHub Action (`.github/workflows/release.yml`) detects pending changesets and creates (or updates) a "Version Packages" PR. This PR bumps version numbers in all `package.json` files and updates changelogs.

2. **Version PR auto-merges** — the release workflow enables GitHub auto-merge on the version PR. Once CI passes, it merges automatically.

3. **Publish and release** — the merge triggers the release workflow again, which publishes `openmembrane` to npm and creates a GitHub Release with a git tag and changelog.

```
feature PR (with changeset) -> main
  -> "Version Packages" PR (auto-created)
    -> CI passes -> auto-merge -> publish to npm + GitHub Release
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

1. Generate a token at [npmjs.com](https://www.npmjs.com/) -> Access Tokens -> Generate New Token (Granular Access Token recommended)
2. Grant the token publish access to the `openmembrane` package
3. In the GitHub repository, go to Settings -> Secrets and variables -> Actions
4. Add a new repository secret named `NPM_TOKEN` with the token value

The `GITHUB_TOKEN` is provided automatically by GitHub Actions.

## Package Overview

| Package | npm Name | Published |
|---------|----------|-----------|
| `apps/mcp-server` | `openmembrane` | Yes |
| `packages/core` | `@openmembrane/core` | No (private) |
| `packages/storage` | `@openmembrane/storage` | No (private) |
| `packages/exporters` | `@openmembrane/exporters` | No (private) |
| `packages/shared` | `@openmembrane/shared` | No (private) |
