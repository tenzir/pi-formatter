This release improves prompt-mode formatting feedback by showing formatter summaries for every touched file. It makes it clear when multiple files were formatted at the end of a run.

## 🐞 Bug fixes

### Prompt-mode formatter summaries for all touched files

Prompt-mode formatter runs now show all formatter summary lines when several files are formatted at the end of a run.

Previously, the interactive UI only kept the last summary line visible, which made it look as though only one file had been formatted even when multiple files were processed with:

```json
{
  "formatMode": "prompt"
}
```

*By @mavam and @codex.*
