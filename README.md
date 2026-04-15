# 🎨 pi-formatter

A [pi](https://pi.dev) extension that auto-formats files after `write` and
`edit` tool calls.

By default, formatting runs once per prompt — after the agent finishes all its
work and yields control back to you. You can also format after each individual
tool call or defer formatting until the session shuts down.

To format after every individual edit instead, set `"formatMode": "tool"`.

## 📦 Install

```bash
pi install npm:pi-formatter
```

## ⚙️ What it does

`pi-formatter` detects file types and runs the appropriate formatter as
best-effort post-processing. Formatter failures never block tool results.

Formatting modes:

- `tool`: format immediately after each successful `write` or `edit` tool call.
  Use this mode when you want files on disk to stay formatted after every edit,
  even while the agent is still working.
- `prompt`: collect all files touched during the agent run and format them once
  when the agent finishes and yields control back to you. This is the default.
  Use this mode to avoid mid-run formatter interruptions while still getting
  clean files after each response.
- `session`: collect files touched during the current session and format them
  once at session shutdown, reload, or switch.
  Use this mode when you want the fewest interruptions and are okay with
  formatting only when the session ends.

Built-in supported file types:

- C/C++
- CMake
- Markdown
- JSON
- Shell
- Python
- JavaScript/TypeScript

For JS/TS and JSON, project-configured tools are preferred first (Biome,
ESLint), with Prettier as a fallback.

When a project contains `treefmt.toml` or `.treefmt.toml` and `treefmt` is
installed, `pi-formatter` prefers `treefmt` before the built-in file-type
runners. This can add support for additional file types declared in the
project's treefmt config. If treefmt reports that no formatter matches a path,
`pi-formatter` falls back to the built-in runners.

For flake-based `treefmt-nix` setups, `pi-formatter` detects flake roots that
contain `treefmt.nix` or `nix/treefmt.nix` and then tries `nix fmt -- <path>`
before falling back to the built-in runners. These `nix fmt` calls are run with
`--no-update-lock-file` and `--no-write-lock-file` so formatting does not
rewrite flake lock files.

When multiple project formatter configs apply, `pi-formatter` uses the nearest
config root. If `treefmt` and `treefmt-nix` share the same root, `treefmt-nix`
is tried first.

## 🎮 Commands

- `/formatter`: open the interactive formatter settings editor and save changes
  to `formatter.json`

## 🔧 Configuration

Create `<agent-dir>/formatter.json`, where `<agent-dir>` is pi's agent config
folder (default: `~/.pi/agent`, overridable via `PI_CODING_AGENT_DIR`):

```json
{
  "formatMode": "prompt",
  "commandTimeoutMs": 10000,
  "hideCallSummariesInTui": false
}
```

- `formatMode`: formatting strategy (`"tool"` | `"prompt"` | `"session"`,
  default: `"prompt"`). Use `"tool"` to format after every individual edit.
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
