---
title: Tool, turn, and session formatting modes
type: breaking
authors:
  - mavam
  - codex
created: 2026-04-02T16:19:24.191447Z
---

The formatter now supports three formatting modes named `tool`, `turn`, and `session`, with `turn` as the default.

This changes the default from the previous immediate `afterEachToolCall` behavior to per-turn batching. If you want to keep the old default, set `"formatMode": "tool"`:

```json
{
  "formatMode": "tool"
}
```

Use `tool` to format after each successful `write` or `edit`, `turn` to batch formatting until the end of each agent turn, or `session` to wait until the current session shuts down. In `session` mode, interrupted runs stay pending until the session exits, reloads, or switches.

This replaces the previous `afterEachToolCall` and `afterAgentStop` values and removes the `formatOnAbort` setting. Update existing configurations like this:

Before:

```json
{
  "formatMode": "afterEachToolCall",
  "formatOnAbort": false
}
```

After:

```json
{
  "formatMode": "tool"
}
```

Or use the new default turn-based behavior:

```json
{
  "formatMode": "turn"
}
```
