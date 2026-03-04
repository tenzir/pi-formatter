---
title: TUI summaries for formatter pass and fail results
type: change
authors:
  - mavam
  - codex
created: 2026-03-03T18:59:29.852033Z
---

Formatting results now show as compact one-line summaries in the TUI after
every `write` and `edit` tool call:

- `✔︎ prettier` on success
- `✘ biome: expected '}' but instead the file ends` on failure

The summaries are on by default and can be hidden with the
`hideCallSummariesInTui` option in `<agent-dir>/formatter.json`
(default: `~/.pi/agent/formatter.json`, overridable via `PI_CODING_AGENT_DIR`).
The previous `PI_FORMAT_SHOW_CALL_SUMMARIES_IN_TUI` environment variable is no
longer used.

Runner IDs now match actual tool names (e.g., `biome` instead of
`biome-check-write`) so the output is immediately recognizable. File kinds
that support multiple formatters (Markdown, JSON, JS/TS) use fallback
precedence, running only the first available formatter.
