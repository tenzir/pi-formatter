---
title: Rename of turn mode to prompt with corrected flush semantics
type: bugfix
authors:
  - mavam
  - claude
created: 2026-04-02T19:15:48.359657Z
---

The `turn` format mode has been renamed to `prompt` and now correctly flushes
after the agent finishes its full run and yields control back to you, rather
than after each internal LLM iteration.

Previously, `"formatMode": "turn"` flushed the formatter after every internal
reasoning step — meaning files could be formatted multiple times mid-run, before
the agent had finished its work. The new `prompt` mode collects all touched
files and formats them exactly once when the agent is done:

```json
{
  "formatMode": "prompt"
}
```

This is now the default. Existing configs that set `"formatMode": "turn"` are
accepted as a deprecated alias and behave identically to `"prompt"`.

The three modes are now:

- `tool` — format immediately after each `write` or `edit`
- `prompt` — format once when the agent finishes and returns control to you (default)
- `session` — format once when the session ends, reloads, or switches
