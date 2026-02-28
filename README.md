# md-kit

Find broken `[[wikilinks]]` and dead relative links in any markdown workspace. Zero dependencies.

## install

```bash
npx @safetnsr/md-kit check .
```

Or install globally:

```bash
npm i -g @safetnsr/md-kit
```

## usage

```bash
md-kit check [dir]
```

Scans all `.md` files recursively. Finds broken `[[wikilinks]]` and `[text](relative-path)` links. Suggests fixes.

```
  FILE                               BROKEN LINK                    TYPE        SUGGESTION
  ──────────────────────────────────────────────────────────────────────────────────────────
  memory/NOW.md                      [[RAEDME]]                     wikilink    README
  docs/guide.md                      [setup](./steup.md)            relative    setup.md
  notes/daily.md                     [[mising-page]]                wikilink    missing-page

✗ 42 files scanned, 87 links checked — 3 broken
```

Exit code `1` if broken links found — CI-friendly.

## flags

| flag | description |
|---|---|
| `--json` | output as JSON (agent interface) |
| `--ignore <pattern>` | ignore files/links matching pattern (repeatable) |
| `--help` | show help |
| `--version` | show version |

## agent interface (`--json`)

```json
{
  "totalFiles": 42,
  "totalLinks": 87,
  "brokenLinks": 3,
  "results": [
    {
      "file": "memory/NOW.md",
      "line": 5,
      "link": "RAEDME",
      "type": "wikilink",
      "suggestion": "README"
    }
  ]
}
```

## what it checks

- `[[wikilinks]]` — resolved against all `.md` files in the workspace
- `[[wikilink|alias]]` — alias stripped, target checked
- `[[wikilink#heading]]` — heading stripped, file checked
- `[text](relative/path.md)` — resolved against filesystem
- Skips: `http://`, `https://`, `mailto:`, `#anchors`, `![[embeds]]`

## pair with

- [@safetnsr/vibe-check](https://github.com/safetnsr/vibe-check) — lint your AI agent sessions
- [@safetnsr/ai-ready](https://github.com/safetnsr/ai-ready) — AI-compatibility score for your codebase
- [@safetnsr/pinch](https://github.com/safetnsr/pinch) — track AI API costs

## license

MIT
