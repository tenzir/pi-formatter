---
title: Accurate treefmt-nix summaries for unmatched files
type: bugfix
authors:
  - mavam
  - codex
created: 2026-04-16T13:09:43.111761Z
---

`pi-formatter` no longer reports successful `treefmt-nix` formatting for files that are not handled by any formatter in the workspace's `nix fmt` setup.

Previously, some unmatched files could still produce a misleading summary like `✔︎ treefmt-nix: path/to/file` even though zero files were actually formatted. These cases are now treated as unmatched, so the false-positive success message disappears and built-in fallback formatters can still run when available.
