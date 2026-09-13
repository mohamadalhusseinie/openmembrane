# OpenMembrane Product Vision

OpenMembrane is a local-first, private, tool-agnostic memory layer for AI coding tools.

AI coding tools forget important project knowledge between sessions. Developers repeatedly restate project rules, architecture decisions, gotchas, conventions, testing commands, deployment constraints, and security requirements. OpenMembrane exists to extract durable project knowledge from AI coding sessions and make it reusable across tools such as Codex, OpenCode, Claude Code, Cursor, VS Code, GitHub Copilot, and future agents.

OpenMembrane is not primarily a CLI, not primarily an OpenCode plugin, and not only an MCP server. OpenMembrane Core is the product.

## Value Proposition

**For individual developers:**
- Stop repeating yourself. Your AI tools remember your project's rules, architecture, gotchas, and conventions across every session, across every tool.
- Your secrets are safe. Credentials, API keys, and sensitive data are detected and blocked before anything is stored.
- Zero maintenance. OpenMembrane learns autonomously from your normal workflow — no manual tagging, no bookmarking, no effort.

**For teams:**
- Planned team modes will provide shared project intelligence so new team members can inherit approved project knowledge.
- Planned team modes will help AI tools operate with a shared understanding of project constraints and conventions.
- GitHub Team will use a manually selected dedicated private repository and one pull request per accepted memory.

**For companies:**
- Planned Self-Hosted Team will run in organization-controlled infrastructure; Managed Team will be an OpenMembrane-operated service.
- Future organization-level policies can control what AI tools can remember and who approves shared knowledge.
- No vendor lock-in. Tool-agnostic by design — works with any AI coding tool that speaks MCP or reads instruction files.

## Product Thesis

OpenMembrane is the protective memory layer between AI coding tools and private project knowledge.

The name combines:

- memory
- brain
- membrane

The membrane idea matters. OpenMembrane should act as a protective boundary. It decides what project knowledge can safely become persistent memory and what must be blocked, redacted, queued for approval, or ignored.

## Main UX

The main workflow should be autonomous:

1. A developer works normally in an AI coding tool.
2. The AI tool discovers durable project knowledge during the session and calls `remember` to save it directly (structured content + type). Alternatively, adapters or hooks can submit full session transcripts via `propose_memory_from_session` for server-side extraction.
3. OpenMembrane runs the memory through its pipeline (secret detection, policy filtering, deduplication, conflict detection).
4. OpenMembrane auto-saves low-risk memory or queues important decisions for approval.
5. Future AI tools retrieve relevant memory through MCP or generated static instruction files.

The primary `remember` path requires no API key — the AI tool performs extraction. The secondary `propose_memory_from_session` path uses a configured LLM extractor for full transcript analysis.

Commands such as `openmembrane remember`, `openmembrane recall`, and `openmembrane export` may exist later as admin or debugging tools, but they are not the core product workflow.

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

See [Deployment Modes](deployment-modes.md) for the canonical mode definitions,
ownership model, approved-memory boundary, and residency language.

- **Local Private** is the current default and stores data in git-ignored
  `.openmembrane/`.
- **GitHub Team** is planned and will share accepted memory through one pull
  request per memory in a manually selected dedicated private repository.
- **Self-Hosted Team** and **Managed Team** are planned.

## Positioning Guardrails

See [Security and Privacy](security-and-privacy.md) and
[Deployment Modes](deployment-modes.md) for the full positioning rules. Key points:

- Local Private is the current release and keeps its store local and git-ignored.
- External LLM usage must be explicit and policy-controlled.
- Stored memory should not be sent to external model providers unless explicitly configured.

## MVP Exclusions

The MVP should not build:

- GitHub Team sync and all other team modes
- SaaS backend
- user accounts
- billing
- team workspaces
- web dashboard
- enterprise admin features
- deep tool-specific plugins

The first product milestone is the local autonomous memory engine.
