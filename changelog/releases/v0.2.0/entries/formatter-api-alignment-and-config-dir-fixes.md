---
title: Formatter API alignment and config/path robustness improvements
type: change
authors:
  - mavam
  - codex
created: 2026-03-04T05:55:00.000000Z
---

`pi-formatter` now aligns more closely with official pi extension APIs and path
handling:

- The formatter config file now lives in `<agent-dir>/formatter.json` using
  pi's `getAgentDir()` resolution (default `~/.pi/agent`, overridable via
  `PI_CODING_AGENT_DIR`).
- The extension now narrows `tool_result` events with official type guards
  (`isWriteToolResult` / `isEditToolResult`) instead of casts.
- Path normalization now handles common Unicode space characters for
  write/edit tool paths.
- C/C++ file detection has been expanded to cover common C and C++ extensions
  (not just `.cpp` / `.hpp`).
- `clang-format` changed-line targeting now considers both unstaged and staged
  diffs.
- JS/TS and JSON fallback behavior is simplified by always allowing Prettier
  as the final fallback runner.
