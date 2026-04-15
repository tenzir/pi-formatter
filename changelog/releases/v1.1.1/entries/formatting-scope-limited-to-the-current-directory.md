---
title: Formatting scope limited to the current directory
type: bugfix
authors:
  - mavam
  - codex
created: 2026-04-15T11:52:40.201426Z
---

`pi-formatter` now limits formatting to files under the current working directory for the active agent run.

Paths outside that directory, including files reached through symlinked directories, are ignored. This keeps formatting focused on the workspace the agent is editing and avoids reformatting unrelated temporary or out-of-scope files.
