This release introduces pi-format, a pi extension that automatically formats files after every `write` and `edit` tool call. Supported languages include C/C++, CMake, Markdown, JSON, Shell, Python, and JavaScript/TypeScript.

## 🚀 Features

### Language-agnostic formatting hooks for pi

Automatic formatting of files after every `write` and `edit` tool call. The extension hooks into successful tool results, detects the file type, and runs the matching formatter. Failures never block tool results, so formatting is always best-effort.

Supported languages: C/C++, CMake, Markdown, JSON, Shell, Python, and JavaScript/TypeScript.

Install with:

```
pi install npm:pi-format
```

*By @mavam and @codex.*
