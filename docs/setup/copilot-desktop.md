# GitHub Copilot Desktop App: Dogfooding From Source

Use OpenMembrane on its own repository through the GitHub Copilot desktop app.
This setup runs the current checkout, not the published npm release.

## Prerequisites And Activation

1. Install Node.js and npm compatible with the locked dependencies. Use a
   current Node.js 22 LTS patch or newer supported LTS release.
2. Open a local checkout or worktree of this repository in the app.
3. Review and accept the repository configuration and MCP trust prompts.
   `.github/github-app.yml` defines dependency setup and manual daemon/review
   scripts; `.github/mcp.json` registers the source MCP server.
4. For an existing session, run `npm ci --no-audit --no-fund` from its checkout.
   The setup script runs on new session creation after configuration trust.
5. Start a new session, or reload the repository MCP server through the app's
   MCP settings if it has not picked up the new configuration. Check that
   OpenMembrane exposes seven tools. Do not assume an already-running
   conversation automatically reloads newly written configuration.

The MCP command is `npm --silent run mcp:stdio`. Silent mode keeps npm's script
banner out of the JSON-RPC stdio stream. It needs no global installation,
compiled bundle, extraction API key, or separately running MCP terminal.
Its first tool call automatically starts the authenticated per-user daemon.
If a daemon is already running, MCP reuses it even if another checkout or a
published release started it. Coordinate with other local sessions, then run
`npm run mcp:stdio -- stop` and `npm run mcp:stdio -- start` from this checkout
before verifying source changes. Repeat after changing daemon/service source.
Reloading MCP alone does not restart the daemon.

## Explicit Memory Opt-In

Tell Copilot:

> Use OpenMembrane for this project. I consent to retrieving non-sensitive
> project memories into Copilot's model context and saving verified, durable,
> non-sensitive project conventions through remember.

Local persistence does not make retrieval offline: retrieved text becomes
part of Copilot's model context and is sent to its model provider. The shared
repository instructions require each user's explicit opt-in before use.
This applies to every OpenMembrane tool, including search and candidate review.
Do not store secrets, personal information, raw source, or full transcripts.

The checked-in MCP configuration enables
`OPENMEMBRANE_MCP_NON_SENSITIVE_ONLY=true`. Before serializing tool results,
the MCP server withholds an entire response containing any memory or candidate
classified as `confidential` or `secret`, including nested proposal memories.
It returns `E_MCP_SENSITIVE_RESPONSE` with a diagnostic ID instead of disclosing
the content. Public and internal entries are allowed. This is an output guard,
not a partial-result filter or a rollback: an approval may already have completed
locally before its response is withheld. Inspect that result in the local review
UI; do not retry the mutation blindly. Other integrations retain their existing
behavior unless they explicitly enable the same environment setting.

The desktop integration uses structured `remember` calls. It does not
automatically ingest whole desktop conversations or install transcript hooks.
This MCP configuration disables transcript extraction; it does not configure
an external extraction provider or GitHub Team synchronization.

## Verify And Review

Ask Copilot to save a non-sensitive project convention with `remember`, then
retrieve it with `get_project_rules` or `get_relevant_context`. Start another
session in the same checkout and retrieve it again to check persistence.

For the local review UI, run the app's **Start OpenMembrane daemon** script
first, followed by **OpenMembrane review**, or run:

```powershell
npm run mcp:stdio -- start
npm run review-ui:local
```

Open the loopback URL printed by the review command (port 4800 by default).
The dedicated script embeds `--no-open` instead of forwarding flags through
the Windows PowerShell npm wrapper, so it does not open a separate browser.
Review saved memories, pending candidates, audit events, and diagnostics there.
The review UI is optional; it is not needed for MCP capture or retrieval.

## Worktrees And Cleanup

By default, each checkout uses its own git-ignored `.openmembrane` directory.
Different worktrees do not automatically share memory. Archiving a worktree
can remove that local store with the checkout; use a long-lived checkout if
you need memory to survive worktree disposal. `OPENMEMBRANE_HOME` can select
an explicitly chosen persistent storage directory, but keep project identity
and storage configuration consistent across MCP and review clients.

Never export over this repository's canonical `AGENTS.md`. Use export preview
or a separate output directory.

Stop the review script when finished. `npm run mcp:stdio -- stop` stops the
per-user daemon and affects other local OpenMembrane sessions too. A later MCP
tool call can start it again. Disable the repository MCP server in the app to
stop using this integration; no global MCP configuration is changed.
