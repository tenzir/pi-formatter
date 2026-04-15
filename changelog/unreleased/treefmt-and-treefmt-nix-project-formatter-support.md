---
title: treefmt and treefmt-nix project formatter support
type: feature
authors:
  - mavam
  - codex
created: 2026-04-15T07:46:07.411154Z
---

`pi-formatter` now prefers project-level `treefmt` setups before its built-in file-type runners.

When a workspace contains `treefmt.toml` or `.treefmt.toml`, the extension runs `treefmt` for the touched file. Flake-based Nix workspaces that use `treefmt.nix`, `nix/treefmt.nix`, or `treefmt-nix` via `flake.nix` are handled through `nix fmt` instead.

This makes project-owned formatter definitions work for file types that are not covered by the built-in runner map. If `nix fmt` is unavailable in the current environment, `pi-formatter` warns and falls back to the built-in runners for the affected file.
