# md-kit

Find broken `[[wikilinks]]` and dead relative links in any markdown workspace. Zero dependencies. Now with event-driven pipeline automation via `md-kit pipe`.

## install

```bash
npx @safetnsr/md-kit check .
```

Or install globally:

```bash
npm i -g @safetnsr/md-kit
```

## usage

### check — find broken links

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

### fix — auto-fix broken links

```bash
md-kit fix [dir]           # dry-run: show fixable links
md-kit fix [dir] --apply   # write fixes to files
md-kit fix [dir] --patch   # write to md-kit-fixes.md for review
```

### mv — move file and update all incoming links

```bash
md-kit mv <old-path> <new-path>           # move and update
md-kit mv <old-path> <new-path> --dry-run # preview
```

### watch — watch directory for changes

```bash
md-kit watch [dir]   # alert on broken links as files change
```

### pipe — markdown content pipelines

Event-driven automation for markdown directories. Watch files, match by path/frontmatter/tags, run multi-step pipelines.

```bash
md-kit pipe init              # scaffold a .md-pipe.yml config file
md-kit pipe watch             # start watching for changes
md-kit pipe once              # run triggers against all files (CI/batch)
md-kit pipe run <pipeline>    # manually run a named pipeline
md-kit pipe test <file>       # show which triggers/pipelines match a file
```

#### config example (`.md-pipe.yml`)

```yaml
watch: ./docs

# Simple triggers: match + run a command
triggers:
  - name: publish
    match:
      path: "posts/**"
      frontmatter:
        status: publish
    run: "echo Publishing $FILE"

# Pipelines (multi-step)
pipelines:
  - name: publish-post
    trigger:
      path: "posts/**"
      frontmatter: { status: publish }
      frontmatter_changed: [status]
    steps:
      - run: "echo Publishing {{fm.title}}"
      - update-frontmatter: { published_at: "{{now}}", published: true }
      - copy: { to: "./_site/posts" }
      - webhook: { url: "$WEBHOOK_URL" }
```

#### trigger match options

| field | description |
|---|---|
| `path` | glob pattern against file's relative path (`posts/**`, `*.md`) |
| `frontmatter` | frontmatter key-value match (supports negation: `!value`) |
| `frontmatter_changed` | fire when listed frontmatter fields change |
| `tags` | file must have all listed tags in frontmatter |
| `content` | file body must contain this substring |
| `content_regex` | file body must match this regex |

#### pipeline step types

| step | description |
|---|---|
| `run` | shell command with template vars |
| `update-frontmatter` | write values back to file's frontmatter |
| `copy` | copy file to destination directory |
| `webhook` | POST JSON to a URL |
| `template` | render a template file and write output |

#### template variables

| variable | value |
|---|---|
| `{{now}}` | ISO timestamp |
| `{{date}}` | YYYY-MM-DD |
| `{{slug}}` | filename without extension |
| `{{file}}` | absolute file path |
| `{{relative}}` | relative path from watch dir |
| `{{fm.title}}` | frontmatter field |
| `{{step.0.stdout}}` | output from pipeline step 0 |

#### pipe flags

| flag | description |
|---|---|
| `--config, -c <path>` | path to config file (default: `.md-pipe.yml`) |
| `--dry-run` | show matches without executing actions |
| `--json` | output in JSON format |
| `--verbose` | show full command output |
| `--debug` | show full interpolated commands |
| `--state <path>` | state file for idempotent `once` mode |

#### CI / batch mode

```bash
# Run once over all files, skip unchanged (idempotent)
md-kit pipe once --state .md-pipe-state.json

# Dry run to preview
md-kit pipe once --dry-run

# JSON output for scripting
md-kit pipe once --json
```

## flags (check/fix)

| flag | description |
|---|---|
| `--json` | output as JSON (agent interface) |
| `--ignore <pattern>` | ignore files/links matching pattern (repeatable) |
| `--apply` | (fix only) apply fixes to files |
| `--patch` | (fix only) write fixes to md-kit-fixes.md |
| `--dry-run` | (mv only) preview without moving |
| `--quiet-if-clean` | (check only) no output if no broken links |
| `--since <date>` | (check only) only files modified after date (YYYY-MM-DD, yesterday, 7days) |
| `--full` | (check only) show all severity levels |
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
