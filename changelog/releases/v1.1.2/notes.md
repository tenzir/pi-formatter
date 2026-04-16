This release fixes false-positive `treefmt-nix` formatting summaries in Nix-based workspaces. `pi-formatter` now reports success only when a formatter actually processes the file, while still allowing built-in formatter fallbacks for unmatched files.

## 🐞 Bug fixes

### Accurate treefmt-nix summaries for unmatched files

`pi-formatter` no longer reports successful `treefmt-nix` formatting for files that are not handled by any formatter in the workspace's `nix fmt` setup.

Previously, some unmatched files could still produce a misleading summary like `✔︎ treefmt-nix: path/to/file` even though zero files were actually formatted. These cases are now treated as unmatched, so the false-positive success message disappears and built-in fallback formatters can still run when available.

*By @mavam and @codex.*
