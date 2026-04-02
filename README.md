# 🎨 pi-formatter

A [pi](https://pi.dev) extension that auto-formats files after `write` and
`edit` tool calls.

By default, formatting runs once per turn. You can also format after each tool
call or defer formatting until the current session shuts down.

This default changed from the previous immediate-per-tool behavior. If you want
the old default, set `"formatMode": "tool"`.

## 📦 Install

```bash
pi install npm:pi-formatter
```

## ⚙️ What it does

`pi-formatter` detects file types and runs the appropriate formatter as
best-effort post-processing. Formatter failures never block tool results.

Formatting modes:

- `tool`: format immediately after each successful `write` or `edit` tool
  result.
  Use this mode when you want the file on disk to stay formatted after every
  edit, even while the agent is still working.
- `turn`: collect files touched during the current turn and format them once at
  `turn_end`. This is the default.
  Use this mode when you want to avoid mid-turn formatter drift while still
  keeping files formatted throughout the run.
- `session`: collect files touched during the current session and format them
  once at `session_shutdown`.
  Use this mode when you want the fewest formatter interruptions and are okay
  with formatting only when the session exits, reloads, or switches. Interrupted
  runs stay pending until the session ends or changes.

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
  "formatMode": "turn",
  "commandTimeoutMs": 10000,
  "hideCallSummariesInTui": false
}
```

- `formatMode`: formatting strategy (`"tool"` | `"turn"` | `"session"`,
  default: `"turn"`). Use `"tool"` to restore the old immediate default.
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
