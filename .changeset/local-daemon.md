---
"openmembrane": minor
---

Add an authenticated per-user local daemon with Unix sockets or Windows loopback TCP, isolated project stores, safe GitHub Team handling, and serve/start/status/stop lifecycle commands. Preserve existing no-argument MCP stdio and add an explicit mcp command.

MCP configurations that previously passed `serve` must switch to `mcp` or omit arguments. Canonical storage paths protect shared indexes across filesystem aliases, and detached startup recovers malformed stale locks.

Daemon startup and GitHub subprocesses exclude inherited GitHub credential variables, using stored `gh` authentication instead. Listener failures throughout startup publication produce safe diagnostics and clean up discovery before failing.

Release the daemon lock and close initialized resources when service or server construction fails, so retries in a still-running host are not blocked by abandoned ownership.

Use a fixed timezone for POSIX process identity and normalize project roots before deriving default IDs, preventing timezone-dependent lock takeover and inconsistent memory visibility across dot-segment path spellings.
