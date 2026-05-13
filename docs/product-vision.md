# OpenMemBrain Product Vision

OpenMemBrain is a local-first, private, tool-agnostic memory layer for AI coding tools.

AI coding tools forget important project knowledge between sessions. Developers repeatedly restate project rules, architecture decisions, gotchas, conventions, testing commands, deployment constraints, and security requirements. OpenMemBrain exists to extract durable project knowledge from AI coding sessions and make it reusable across tools such as Codex, OpenCode, Claude Code, Cursor, VS Code, GitHub Copilot, and future agents.

OpenMemBrain is not primarily a CLI, not primarily an OpenCode plugin, and not only an MCP server. OpenMemBrain Core is the product.

## Product Thesis

OpenMemBrain is the protective memory layer between AI coding tools and private project knowledge.

The name combines:

- memory
- brain
- membrane

The membrane idea matters. OpenMemBrain should act as a protective boundary. It decides what project knowledge can safely become persistent memory and what must be blocked, redacted, queued for approval, or ignored.

## Main UX

The main workflow should be autonomous:

1. A developer works normally in an AI coding tool.
2. OpenMemBrain receives a session transcript or summary through an adapter, hook, MCP tool, or local ingestion API.
3. OpenMemBrain analyzes the session.
4. OpenMemBrain extracts only durable knowledge worth remembering.
5. OpenMemBrain blocks secrets and unsafe content.
6. OpenMemBrain auto-saves low-risk memory or queues important decisions for approval.
7. Future AI tools retrieve relevant memory through MCP or generated static instruction files.

Commands such as `openmembrain remember`, `openmembrain recall`, and `openmembrain export` may exist later as admin or debugging tools, but they are not the core product workflow.

## Memory Worth Saving

A memory is worth saving only if it is:

- durable
- project-specific
- likely to affect future coding
- verified by the user, the final session outcome, or the codebase
- not temporary debugging noise
- not a secret
- not raw sensitive data
- not generic programming advice
- not emotional commentary
- not an unverified AI assumption

Good memory examples:

- This project uses Angular standalone components. Do not introduce NgModules.
- Database schema changes must use Flyway migrations.
- Stripe success flow should use `session_id` instead of exposing internal request IDs.
- Runtime environment config is preferred over compile-time environment replacement.
- Frontend tests require runtime config to be mocked.
- Do not use `any` in TypeScript unless explicitly approved.
- Public DTO changes require checking frontend consumers.
- Local development disables auth, but deployed environments use JWT/OIDC.

Bad memory examples:

- The user was annoyed.
- Maybe the webhook has a bug.
- The AI tried a wrong fix.
- Temporary stack traces.
- API keys or credentials.
- Large copied source code snippets.
- Generic advice like "write clean code".
- An unverified assumption from the AI.
- A failed debugging attempt unless it resulted in a verified gotcha.

## Product Modes

The product should eventually support multiple operating modes:

- Local-only mode: all memory stays on the developer machine.
- CH/EU sync mode: encrypted memory can be synced to CH/EU-hosted infrastructure.
- Self-hosted mode: companies can run OpenMemBrain inside their own infrastructure.
- Hosted mode: OpenMemBrain may provide managed sync, teams, policy, audit logs, and administration.

The MVP implements local-only mode.

## Positioning Guardrails

See [Security and Privacy](security-and-privacy.md#cheu-security-positioning) for the full positioning rules. Key points:

- Local-only mode keeps memory on the developer machine.
- External LLM usage must be explicit and policy-controlled.
- Stored memory should not be sent to external model providers unless explicitly configured.

## MVP Exclusions

The MVP should not build:

- cloud sync
- SaaS backend
- user accounts
- billing
- team workspaces
- web dashboard
- enterprise admin features
- deep tool-specific plugins

The first product milestone is the local autonomous memory engine.
