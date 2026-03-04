This release makes pi-formatter easier to trust and operate by adding concise pass/fail summaries in the TUI after each write and edit action. It also aligns the extension with official pi APIs and improves config, path, and formatter fallback handling across file types.

## 🔧 Changes

### Formatter API alignment and config/path robustness improvements

`pi-formatter` now aligns more closely with official pi extension APIs and path handling:

- The formatter config file now lives in `<agent-dir>/formatter.json` using pi's `getAgentDir()` resolution (default `~/.pi/agent`, overridable via `PI_CODING_AGENT_DIR`).
- The extension now narrows `tool_result` events with official type guards (`isWriteToolResult` / `isEditToolResult`) instead of casts.
- Path normalization now handles common Unicode space characters for write/edit tool paths.
- C/C++ file detection has been expanded to cover common C and C++ extensions (not just `.cpp` / `.hpp`).
- `clang-format` changed-line targeting now considers both unstaged and staged diffs.
- JS/TS and JSON fallback behavior is simplified by always allowing Prettier as the final fallback runner.

*By @mavam and @codex.*

### TUI summaries for formatter pass and fail results

Formatting results now show as compact one-line summaries in the TUI after every `write` and `edit` tool call:

- `✔︎ prettier` on success
- `✘ biome: expected '}' but instead the file ends` on failure

The summaries are on by default and can be hidden with the `hideCallSummariesInTui` option in `<agent-dir>/formatter.json` (default: `~/.pi/agent/formatter.json`, overridable via `PI_CODING_AGENT_DIR`). The previous `PI_FORMAT_SHOW_CALL_SUMMARIES_IN_TUI` environment variable is no longer used.

Runner IDs now match actual tool names (e.g., `biome` instead of `biome-check-write`) so the output is immediately recognizable. File kinds that support multiple formatters (Markdown, JSON, JS/TS) use fallback precedence, running only the first available formatter.

*By @mavam and @codex.*
