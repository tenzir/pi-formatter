This release keeps pi-formatter focused on the workspace you are actively editing. It now ignores files outside the current directory and skips paths that traverse symlinks, so unrelated files do not get reformatted during an agent run.

## 🐞 Bug fixes

### Formatting scope limited to the current directory

`pi-formatter` now limits formatting to files under the current working directory for the active agent run.

Paths outside that directory, including files reached through symlinked directories, are ignored. This keeps formatting focused on the workspace the agent is editing and avoids reformatting unrelated temporary or out-of-scope files.

*By @mavam and @codex.*
