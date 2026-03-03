# 🎨 pi-formatter

A [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
extension that auto-formats files after every `write` and `edit` tool call.

The extension hooks into successful tool results, detects the file type, and
runs the appropriate formatter. Failures never block the tool result, so
formatting is always best-effort.

## 📦 Install

```bash
pi install npm:pi-formatter
```

## ⚙️ What it does

`pi-formatter` listens to successful `write` and `edit` tool calls and applies
best-effort formatting. Formatter failures never block tool results.

Supported file types:

- C/C++
- CMake
- Markdown
- JSON
- Shell
- Python
- JavaScript/TypeScript

## 🔧 Configuration

- `PI_FORMAT_COMMAND_TIMEOUT_MS`: timeout (ms) per formatter command (default: `10000`)

## 🧩 Contributor docs

See the [runner API contract](DOCUMENTATION.md) for how to add new formatters.

## 📄 License

[Apache-2.0](LICENSE)
