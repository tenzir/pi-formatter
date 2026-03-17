# 🎨 pi-formatter

A [pi](https://pi.dev) extension that auto-formats files after `write` and
`edit` tool calls.

By default, formatting runs after each successful tool result. It can also be
configured to defer formatting until the agent stops and yields back to the
user.

## 📦 Install

```bash
pi install npm:pi-formatter
```

## ⚙️ What it does

`pi-formatter` detects file types and runs the appropriate formatter as
best-effort post-processing. Formatter failures never block tool results.

Formatting modes:

- `afterEachToolCall`: format immediately after each successful `write` or
  `edit` tool result. This is the default.
- `afterAgentStop`: collect touched files during the run and format them once
  the agent stops. This avoids mid-run model drift from formatter edits.

When `afterAgentStop` is active, interrupted or canceled runs are not formatted
unless `formatOnAbort` is enabled.

Supported file types:

- C/C++
- CMake
- Markdown
- JSON
- Shell
- Python
- JavaScript/TypeScript

For JS/TS and JSON, project-configured tools are preferred first (Biome,
ESLint), with Prettier as a fallback.

## 🎮 Commands

- `/formatter`: open the interactive formatter settings editor and save changes
  to `formatter.json`

## 🔧 Configuration

Create `<agent-dir>/formatter.json`, where `<agent-dir>` is pi's agent config
folder (default: `~/.pi/agent`, overridable via `PI_CODING_AGENT_DIR`):

```json
{
  "formatMode": "afterEachToolCall",
  "formatOnAbort": false,
  "commandTimeoutMs": 10000,
  "hideCallSummariesInTui": false
}
```

- `formatMode`: formatting strategy
  (`"afterEachToolCall"` | `"afterAgentStop"`, default: `"afterEachToolCall"`)
- `formatOnAbort`: in deferred mode, also format files after an interrupted or
  canceled run (default: `false`)
- `commandTimeoutMs`: timeout (ms) per formatter command (default: `10000`)
- `hideCallSummariesInTui`: hide formatter pass/fail summaries in the TUI
  (default: `false`)

## 🧩 Adding formatters

Each formatter is a _runner_ that wraps a CLI tool behind a common interface.
To add one:

1. Create a file in `extensions/formatter/runners/` using `defineRunner` and a
   launcher helper (`direct`, `pypi`, or `goTool`).
2. Register it in `extensions/formatter/runners/index.ts`.
3. Add its id to a group in `extensions/formatter/plan.ts`.

The format plan maps file kinds to ordered runner groups. Each group runs in
`"all"` mode (every runner) or `"fallback"` mode (first match wins).

## 📄 License

[Apache-2.0](LICENSE)
