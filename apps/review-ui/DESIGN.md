# Review workspace design

The review UI is an operational developer tool. Favor recognition, readable
knowledge, and explicit decision consequences over dashboard decoration.

- Use the system UI font with hierarchy supplied by size, weight, and spacing.
  Headings range from 18px section titles to the 38px overview introduction;
  body content is 14–16px. One family is intentional.
- Keep neutral surfaces, blue primary actions, and semantic error/blocked states.
  Respect the operating system's light/dark preference. Load no remote fonts or
  assets.
- Group navigation into overview/review, knowledge maintenance, and
  troubleshooting. The current project remains visible. On small screens,
  navigation becomes a collapsible two-column grid above the workspace, closed
  initially so the current task is immediately visible.
- Make the review queue the overview's primary action. Attention rows use live
  queue and older-memory data, not inferred health scores or capped totals.
- Show complete memory and proposal text. Keep reasons next to decisions.
  Secondary maintenance and whole-queue actions use progressive disclosure.
- Loading, empty, unavailable, blocked, and pending-mutation states must remain
  distinct. Error notifications persist until dismissed.
- Use semantic navigation, native buttons and disclosures, visible focus,
  descriptive labels, a skip link, and live status regions. Move focus to the
  heading after view changes and completed queue decisions.

Implementation: `public/workspace.css` defines the workspace layer over the
existing graph and review controls in `public/index.html`. Existing graph colors
continue to encode entity and relationship types, not primary-action priority.
