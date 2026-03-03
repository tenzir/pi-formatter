---
title: Language-agnostic formatting hooks for pi
type: feature
authors:
  - mavam
  - codex
created: 2026-03-03T14:47:57.211282Z
---

Automatic formatting of files after every `write` and `edit` tool call.
The extension hooks into successful tool results, detects the file type,
and runs the matching formatter. Failures never block tool results, so
formatting is always best-effort.

Supported languages: C/C++, CMake, Markdown, JSON, Shell, Python, and
JavaScript/TypeScript.

Install with:

```
pi install npm:pi-format
```
