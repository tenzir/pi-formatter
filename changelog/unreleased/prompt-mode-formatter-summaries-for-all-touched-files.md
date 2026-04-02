---
title: Prompt-mode formatter summaries for all touched files
type: bugfix
authors:
  - mavam
  - codex
created: 2026-04-02T19:56:30.672794Z
---

Prompt-mode formatter runs now show all formatter summary lines when several files are formatted at the end of a run.

Previously, the interactive UI only kept the last summary line visible, which made it look as though only one file had been formatted even when multiple files were processed with:

```json
{
  "formatMode": "prompt"
}
```
