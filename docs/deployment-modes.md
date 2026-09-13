# OpenMembrane Deployment Modes

OpenMembrane is designed around distinct deployment modes. They define where
memory is stored, who owns the storage, and what may leave a developer's local
project. The current release ships **Local Private** only.

## Local Private

**Status:** Current and default mode.

Local Private stores OpenMembrane data in `.openmembrane/` in the project
directory by default. That directory is git-ignored. Approved memories,
pending candidates, audit events, and diagnostics remain in the local store.

No account or cloud service is required. External LLM extraction is separate
from the deployment mode: it is off unless explicitly configured, and secrets
are redacted before a configured provider is called.

## GitHub Team

**Status:** Planned.

GitHub Team will let a team manually select one dedicated private GitHub
repository for each OpenMembrane project. The repository is owned and accessed
through the user's own `gh` authentication; OpenMembrane will not manage GitHub
credentials.

Only accepted memory will sync. Each accepted memory will be proposed in its
own pull request, so the repository's normal review and merge controls govern
what becomes shared project knowledge.

GitHub Team will not sync pending candidates, raw transcripts, source
excerpts, diagnostics, or credentials. It is not a replacement for the local
store and does not change Local Private's default behavior.

## Self-Hosted Team

**Status:** Planned.

Self-Hosted Team will allow an organization to run its team memory service and
storage in infrastructure it controls. Its hosting location, identity,
policies, and model-provider configuration will be determined by the deploying
organization.

## Managed Team

**Status:** Planned.

Managed Team will provide an OpenMembrane-operated team service with shared
memory and administration features. Its data handling, locations, and controls
will be specified when the mode is designed and released.

## Residency Language

Local Private data remains on the developer's machine unless the developer
explicitly configures an external LLM provider. GitHub Team data will be stored
in the manually selected GitHub repository and is subject to GitHub's service
and the repository owner's configuration. Self-Hosted Team location is chosen
by the deploying organization.

Do not describe a planned mode as Swiss-, EU-, or otherwise region-hosted, and
do not make compliance or data-residency claims, until a released mode has
documented guarantees that support those claims.

## Static Exports

Static exports are not GitHub Team sync. The `export_static_memory_files` tool
creates local instruction files for AI tools that cannot retrieve memory over
MCP. Those files may be committed by a project, and exporters omit
`confidential` memories by default. They do not implement shared-memory sync,
GitHub pull requests, or the approved-memory boundary used by GitHub Team.
