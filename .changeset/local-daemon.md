---
"openmembrane": minor
---

Add an authenticated per-user local daemon with Unix sockets or Windows loopback TCP, isolated project stores, safe GitHub Team handling, and serve/start/status/stop lifecycle commands. Preserve existing no-argument MCP stdio and add an explicit mcp command.

MCP configurations that previously passed `serve` must switch to `mcp` or omit arguments. Canonical storage paths protect shared indexes across filesystem aliases, and detached startup recovers malformed stale locks.
