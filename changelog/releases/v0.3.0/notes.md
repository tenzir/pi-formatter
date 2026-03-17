The formatter now supports a formatMode setting to control whether files are formatted after each tool call or once the agent stops, preventing mid-run model drift. A new /formatter slash command provides an interactive settings editor for all formatter options.

## 🚀 Features

### Configurable formatting modes and settings command

The formatter now supports two modes controlled by the `formatMode` setting:

- `afterEachToolCall` (default): formats immediately after each successful `write` or `edit` tool result. This preserves the existing behavior.
- `afterAgentStop`: collects touched files during the run and formats them once the agent yields back to the user. This avoids mid-run model drift from formatter edits.

When `afterAgentStop` is active, interrupted or canceled runs skip formatting unless `formatOnAbort` is enabled.

A new `/formatter` slash command opens an interactive settings editor to configure the format mode, abort behavior, command timeout, and TUI summary visibility. Changes are persisted to `formatter.json`.

*By @mavam and @codex in #1.*
