# OpenMembrane for VS Code

Local-first project memory alongside GitHub Copilot Chat. Publisher:
`mohamadalhusseinie`. Requires desktop VS Code 1.104 or later and a trusted,
local filesystem workspace (including a filesystem workspace in a remote
extension host). GitHub Copilot Chat is required to use chat and MCP tools.

## Install from this repository

From the repository root:

```sh
npm ci
npm run package -w packages/adapter-vscode
```

Use **Extensions: Install from VSIX...** and select the generated
`packages/adapter-vscode/openmembrane-vscode-1.0.2.vsix`, then open a project folder.
Marketplace listing and publishing are not part of this release.

The extension bundles the existing OpenMembrane CLI and its JavaScript
dependencies. No global CLI or manual `.vscode/mcp.json` is required. Activation
checks daemon health and starts the per-user daemon if absent. VS Code discovers
one OpenMembrane MCP definition per workspace folder; accept VS Code's normal
MCP trust/start prompt and enable the tools in Copilot's tools picker. Existing
manual MCP registrations should be removed to avoid duplicate servers.

The extension uses VS Code's Node runtime. JSON storage is the default; the
optional native SQLite driver is not shipped in the VSIX. Existing daemon
configuration and environment variables still apply. The shared per-user daemon
continues running after the extension is deactivated.

## Chat and commands

| Entry point | Behavior |
|---|---|
| `@openmembrane /rules` or `@openmembrane rules` | Show project rules from the daemon |
| `@openmembrane /recall <query>` or `@openmembrane recall <query>` | Retrieve relevant memory |
| `@openmembrane /review` | Open the candidate review webview |
| `@openmembrane /save` | Ingest the history visible to this participant |
| **OpenMembrane: Review candidates** | List, approve, and reject pending candidates in a webview |
| **OpenMembrane: Export static files** | Confirm and generate static fallback files using daemon defaults |
| **OpenMembrane: Show diagnostics** | Show project diagnostic IDs/messages in the OpenMembrane output channel |
| **Save chat session to OpenMembrane** | Select an exported chat JSON, Markdown, or text file, confirm, and ingest it |

Multi-root workspaces prompt for the project for each operation rather than
guessing which folder owns a conversation. No folder means no daemon startup or
MCP definition; project operations ask the user to open a folder.

## Capture limitations and privacy

The stable VS Code 1.104 API has **no general Copilot Chat session lifecycle or
transcript API**. `ChatContext.history` contains only this participant's turns.
The extension does not read Copilot's private storage or call undocumented
commands, and cannot silently capture ordinary Copilot or other participants.

For a normal Copilot session, use VS Code's **Chat: Export Chat...** action,
then run **Save chat session to OpenMembrane**, select the export and confirm
the target project. Exports must be non-empty and at most 100,000 characters
(files over 1 MB are rejected before reading). Split larger exports first.
The extension does not retain a second copy of the raw transcript.

`openmembrane.autoSave` defaults to `false`. Opting in saves each completed
`/rules` or `/recall` exchange handled by `@openmembrane`; it is not an
all-Copilot auto-save hook. `/save` explicitly captures the participant's
visible history instead. Chat capture is sent only to the local authenticated
daemon, which owns redaction, extraction, deduplication and approval policy.
External extraction requires explicit daemon configuration; configure that
policy before capturing sensitive chats. Retrieval via MCP may be sent to the
model used by Copilot when you enable/use those tools.

Errors show safe client messages and daemon diagnostic IDs where available.
Use **Show diagnostics** or the local daemon log for investigation. Candidate
contents are escaped in the webview; no daemon token or HTTP endpoint is exposed
to webview scripts.

## Development

```sh
npm run typecheck
npm test -- tests/unit/VscodeAdapter.test.ts
npm run test:host -w packages/adapter-vscode
```

Host tests use `@vscode/test-electron` with VS Code 1.104, an isolated home and
workspace, and the bundled CLI. Linux requires a display (CI uses `xvfb-run`).
They exercise real activation/bootstrap, participant requests, registered
commands, MCP definitions and a real MCP retrieval round-trip. Unit tests cover
capture opt-in, review messages and error/cancellation paths.
