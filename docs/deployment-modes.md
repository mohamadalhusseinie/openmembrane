# OpenMembrane Deployment Modes

OpenMembrane is designed around distinct deployment modes. They define where
memory is stored, who owns the storage, and what may leave a developer's local
project. The current release ships **Local Private** and **GitHub Team**.

## Local Private

**Status:** Current and default mode.

Local Private stores OpenMembrane data in `.openmembrane/` in the project
directory by default. That directory is git-ignored. Approved memories,
pending candidates, audit events, and diagnostics remain in the local store.

No account or cloud service is required. External LLM extraction is separate
from the deployment mode: it is off unless explicitly configured, and secrets
are redacted before a configured provider is called.

## GitHub Team

**Status:** Current. Initial release limitations apply.

GitHub Team lets a team manually select one dedicated private GitHub
repository for each OpenMembrane project. The repository is owned and accessed
through the user's own installed and authenticated `gh` CLI; OpenMembrane does
not manage GitHub credentials.

Only accepted memory syncs. Each accepted memory is proposed in its own pull
request. Only memories merged to the repository's default branch become shared
project knowledge; the merged default branch is authoritative.

GitHub Team is initially tested with GitHub.com. Its `gh` integration accepts a
repository host, but GitHub Enterprise Server is not formally supported. The
selected repository must be dedicated, private, and either empty or already
initialized by OpenMembrane.

GitHub Team does not sync pending candidates, raw transcripts, source excerpts,
diagnostics, or credentials. It is not a replacement for the local store and
does not change Local Private's default behavior.

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
explicitly configures an external LLM provider. GitHub Team data is stored
in the manually selected GitHub repository and is subject to GitHub's service
and the repository owner's configuration. Self-Hosted Team location is chosen
by the deploying organization.

Do not describe GitHub Team or a planned mode as Swiss-, EU-, or otherwise
region-hosted, and do not make compliance or data-residency claims without
documented guarantees that support those claims.

## Static Exports

Static exports are not GitHub Team sync. The `export_static_memory_files` tool
creates local instruction files for AI tools that cannot retrieve memory over
MCP. Those files may be committed by a project, and exporters omit
`confidential` memories by default. They do not implement shared-memory sync,
GitHub pull requests, or the approved-memory boundary used by GitHub Team.
