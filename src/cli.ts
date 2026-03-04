#!/usr/bin/env node

import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, chmodSync, watch } from 'node:fs';
import { findMarkdownFiles, extractLinks, readFile } from './core/scanner.js';
import { findBrokenLinks, countIgnored, BrokenLink } from './core/resolver.js';
import { formatTable, formatJson, DisplayLevel } from './core/reporter.js';
import { moveFile } from './core/mover.js';
import { addIgnorePattern } from './core/ignore.js';
import { getLastModified, parseSinceDate } from './core/severity.js';
import { findConfigFile, loadConfig, generateDefaultConfig } from './pipe/config.js';
import { MdPipeWatcher } from './pipe/watcher.js';
import { runOnce } from './pipe/once.js';
import { testFile } from './pipe/test-file.js';
import { runPipelineCommand } from './pipe/run-command.js';
import type { PipelineResult } from './pipe/pipeline.js';

const VERSION = '0.2.0';

const HELP = `
md-kit — find broken [[wikilinks]] and dead relative links in any markdown workspace

USAGE
  md-kit check [dir]            scan for broken links (default: .)
  md-kit fix [dir]              show fixable broken links (dry-run)
  md-kit fix [dir] --apply      write fixes to files
  md-kit fix [dir] --patch      write fixes to md-kit-fixes.md for review
  md-kit mv <old> <new>         move file and update all incoming links
  md-kit mv <old> <new> --dry-run  preview without moving
  md-kit watch [dir]            watch for changes and alert on broken links
  md-kit ignore <link>          add link to .mdkitignore
  md-kit install                install pre-commit git hook
  md-kit setup                  auto-configure for agent workspace
  md-kit pipe init              scaffold a .md-pipe.yml config file
  md-kit pipe watch             watch directory and run pipelines on file changes
  md-kit pipe once              run triggers/pipelines against current files (CI/batch)
  md-kit pipe run <pipeline>    manually run a pipeline on matching files
  md-kit pipe test <file>       show which triggers/pipelines match a file

FLAGS
  --json                   output as JSON (agent interface)
  --ignore <pattern>       glob pattern to ignore (repeatable)
  --apply                  (fix only) apply fixes to files
  --patch                  (fix only) write fixes to md-kit-fixes.md
  --dry-run                (mv only) preview without moving
  --quiet-if-clean         (check only) no output if no broken links found
  --git-alias              (setup only) install git mmd alias
  --full                   (check only) show all severity levels
  --critical               (check only) show only critical items (default)
  --warnings               (check only) show critical + warning items
  --since <date>           (check only) only files modified after date
                           formats: YYYY-MM-DD, yesterday, 7days
`;

export interface ParsedArgs {
  command: string;
  dir: string;
  json: boolean;
  ignore: string[];
  help: boolean;
  version: boolean;
  apply: boolean;
  patch: boolean;
  dryRun: boolean;
  quietIfClean: boolean;
  gitAlias: boolean;
  positionals: string[];
  full: boolean;
  critical: boolean;
  warnings: boolean;
  since: string | null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command = '';
  let dir = '.';
  let json = false;
  const ignore: string[] = [];
  let help = false;
  let version = false;
  let apply = false;
  let patch = false;
  let dryRun = false;
  let quietIfClean = false;
  let gitAlias = false;
  let full = false;
  let critical = false;
  let warnings = false;
  let since: string | null = null;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version' || arg === '-v') {
      version = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--patch') {
      patch = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--quiet-if-clean') {
      quietIfClean = true;
    } else if (arg === '--git-alias') {
      gitAlias = true;
    } else if (arg === '--full') {
      full = true;
    } else if (arg === '--critical') {
      critical = true;
    } else if (arg === '--warnings') {
      warnings = true;
    } else if (arg === '--since' && i + 1 < args.length) {
      since = args[++i];
    } else if (arg === '--ignore' && i + 1 < args.length) {
      ignore.push(args[++i]);
    } else if (!command && !arg.startsWith('-')) {
      command = arg;
    } else if (command && !arg.startsWith('-')) {
      positionals.push(arg);
      if (command !== 'mv' && command !== 'ignore') {
        dir = arg;
      }
    }
  }

  return { command, dir, json, ignore, help, version, apply, patch, dryRun, quietIfClean, gitAlias, positionals, full, critical, warnings, since };
}

/**
 * Core check logic reused by check, fix, and watch
 */
function runCheck(baseDir: string, opts: { ignore: string[] }): {
  files: string[];
  allLinks: ReturnType<typeof extractLinks>;
  broken: BrokenLink[];
  ignoredCount: number;
} {
  const files = findMarkdownFiles(baseDir);
  const allLinks: ReturnType<typeof extractLinks> = [];
  for (const file of files) {
    const content = readFile(resolve(baseDir, file));
    if (content !== null) {
      allLinks.push(...extractLinks(file, content));
    }
  }

  let filteredLinks = allLinks;
  if (opts.ignore.length > 0) {
    filteredLinks = allLinks.filter(link => {
      return !opts.ignore.some(pattern => link.file.includes(pattern) || link.target.includes(pattern));
    });
  }

  const ignoredCount = countIgnored(filteredLinks, baseDir);
  const broken = findBrokenLinks(filteredLinks, files, baseDir);
  return { files, allLinks: filteredLinks, broken, ignoredCount };
}

/**
 * install command — pre-commit git hook
 */
function cmdInstall(): number {
  // Find .git directory by walking up
  let dir = process.cwd();
  while (!existsSync(join(dir, '.git'))) {
    const parent = resolve(dir, '..');
    if (parent === dir) {
      process.stderr.write('Error: not in a git repository\n');
      return 1;
    }
    dir = parent;
  }

  const hooksDir = join(dir, '.git', 'hooks');
  const hookPath = join(hooksDir, 'pre-commit');

  const hookContent = `#!/bin/sh
# md-kit pre-commit hook
CHANGED=$(git diff --cached --name-only --diff-filter=ADMR | grep '\\.md$')
if [ -n "$CHANGED" ]; then
  OUTPUT=$(npx @safetnsr/md-kit check . --json --quiet-if-clean 2>/dev/null)
  if [ -z "$OUTPUT" ]; then
    exit 0
  fi
  BROKEN=$(echo "$OUTPUT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(String(j.broken_count||0))}catch{process.stdout.write('0')}})")
  if [ "$BROKEN" = "0" ]; then
    exit 0
  fi
  echo ""
  echo "md-kit: $BROKEN broken link(s) found"
  npx @safetnsr/md-kit check . 2>/dev/null
  echo ""
  printf "fix broken links automatically? [Y/n] "
  read REPLY </dev/tty
  if [ "$REPLY" = "n" ] || [ "$REPLY" = "N" ]; then
    echo "commit blocked. fix links manually or run: md-kit fix . --apply"
    exit 1
  fi
  npx @safetnsr/md-kit fix . --apply 2>/dev/null
  git add -A
  echo "links fixed. continuing commit."
fi
exit 0
`;

  mkdirSync(hooksDir, { recursive: true });

  if (existsSync(hookPath)) {
    // Append to existing hook
    appendFileSync(hookPath, '\n' + hookContent);
  } else {
    writeFileSync(hookPath, hookContent);
  }
  chmodSync(hookPath, 0o755);

  process.stdout.write('md-kit pre-commit hook installed at .git/hooks/pre-commit\n');
  return 0;
}

/**
 * fix command — auto-update broken links
 */
function cmdFix(opts: ParsedArgs): number {
  const baseDir = resolve(opts.dir);
  const { files, allLinks, broken } = runCheck(baseDir, opts);

  const fixable = broken.filter(b => b.suggestion !== null);
  const skipped = broken.filter(b => b.suggestion === null);

  // --patch mode: write md-kit-fixes.md
  if (opts.patch) {
    if (fixable.length === 0 && skipped.length === 0) {
      process.stdout.write('no broken links found\n');
      return 0;
    }

    const now = new Date().toISOString().slice(0, 10);
    const lines: string[] = [
      '# md-kit fixes',
      `generated: ${now}`,
      '',
      '## pending fixes (run `md-kit fix . --apply` to apply all)',
      '',
    ];

    for (const b of [...fixable, ...skipped]) {
      const newRaw = b.suggestion
        ? (b.type === 'wikilink'
            ? b.raw.replace(b.target, b.suggestion)
            : b.raw.replace(b.target, b.suggestion + (b.target.endsWith('.md') ? '.md' : '')))
        : null;

      lines.push(`### ${b.file}:${b.line}`);
      lines.push(`- broken: \`${b.raw}\``);
      if (newRaw) {
        lines.push(`- suggestion: \`${newRaw}\``);
        lines.push('- fix: replace with suggestion');
      } else {
        lines.push('- suggestion: none');
        lines.push('- fix: manual review needed');
      }
      lines.push('');
    }

    const patchPath = join(baseDir, 'md-kit-fixes.md');
    writeFileSync(patchPath, lines.join('\n'));
    process.stdout.write('wrote md-kit-fixes.md — review and run `md-kit fix . --apply` to apply\n');
    return fixable.length > 0 || skipped.length > 0 ? 1 : 0;
  }

  if (opts.json) {
    const result = {
      fixed: fixable.map(b => ({
        file: b.file,
        line: b.line,
        old: b.raw,
        new: b.type === 'wikilink'
          ? b.raw.replace(b.target, b.suggestion!)
          : b.raw.replace(b.target, b.suggestion! + (b.target.endsWith('.md') ? '.md' : '')),
      })),
      skipped: skipped.map(b => ({
        file: b.file,
        link: b.target,
        reason: 'no suggestion',
      })),
      dry_run: !opts.apply,
    };

    if (opts.apply) {
      applyFixes(baseDir, fixable);
    }

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return fixable.length > 0 || skipped.length > 0 ? 1 : 0;
  }

  if (fixable.length === 0 && skipped.length === 0) {
    process.stdout.write('no broken links found\n');
    return 0;
  }

  if (opts.apply) {
    const filesChanged = applyFixes(baseDir, fixable);
    process.stdout.write(`fixed ${fixable.length} links in ${filesChanged} files\n`);
    if (skipped.length > 0) {
      process.stdout.write(`skipped ${skipped.length} links (no suggestion)\n`);
    }
    return skipped.length > 0 ? 1 : 0;
  }

  // Dry run
  if (fixable.length > 0) {
    process.stdout.write(`would fix ${fixable.length} links (run with --apply to apply):\n`);
    for (const b of fixable) {
      const newRaw = b.type === 'wikilink'
        ? b.raw.replace(b.target, b.suggestion!)
        : b.raw.replace(b.target, b.suggestion! + (b.target.endsWith('.md') ? '.md' : ''));
      process.stdout.write(`  ${b.file}:${b.line}  ${b.raw} → ${newRaw}\n`);
    }
  }

  if (skipped.length > 0) {
    process.stdout.write(`\nskipped ${skipped.length} links (no suggestion):\n`);
    for (const b of skipped) {
      process.stdout.write(`  ${b.file}:${b.line}  ${b.raw}\n`);
    }
  }

  return 1;
}

/**
 * mv command — move file and update all incoming links
 */
function cmdMv(opts: ParsedArgs): number {
  if (opts.positionals.length < 2) {
    process.stderr.write('Usage: md-kit mv <old-path> <new-path> [--dry-run] [--json]\n');
    return 1;
  }

  const oldPath = opts.positionals[0];
  const newPath = opts.positionals[1];
  const baseDir = process.cwd();

  try {
    const result = moveFile(baseDir, oldPath, newPath, { dryRun: opts.dryRun, json: opts.json });

    if (opts.json) {
      process.stdout.write(JSON.stringify({
        moved: result.moved,
        old: result.old,
        new: result.new,
        links_updated: result.links_updated,
        files_updated: result.files_updated,
        dry_run: opts.dryRun,
      }, null, 2) + '\n');
    } else {
      const verb = opts.dryRun ? 'would move' : 'moved';
      process.stdout.write(`${verb}: ${result.old} → ${result.new}\n`);
      if (result.updates.length > 0) {
        const verb2 = opts.dryRun ? 'would update' : 'updated';
        process.stdout.write(`${verb2} ${result.links_updated} links in ${result.files_updated.length} files:\n`);
        for (const u of result.updates) {
          process.stdout.write(`  ${u.file}:${u.line}\t${u.oldRaw} → ${u.newRaw}\n`);
        }
      }
    }

    return 0;
  } catch (e: any) {
    process.stderr.write(`Error: ${e.message}\n`);
    return 1;
  }
}

/**
 * ignore command — add link to .mdkitignore
 */
function cmdIgnore(opts: ParsedArgs): number {
  if (opts.positionals.length < 1) {
    process.stderr.write('Usage: md-kit ignore <link>\n');
    return 1;
  }
  const link = opts.positionals[0];
  const baseDir = resolve(opts.dir);
  addIgnorePattern(link, baseDir);
  process.stdout.write(`added [[${link}]] to .mdkitignore\n`);
  return 0;
}

/**
 * Install git mmd alias — returns true if installed, false if skipped
 */
export function installGitAlias(): boolean {
  try {
    const { execSync } = require('node:child_process');
    // Check if git is available
    execSync('git config --list', { stdio: 'pipe' });
    // Check if alias already exists
    try {
      const existing = execSync('git config alias.mmd', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (existing) {
        return false; // already exists
      }
    } catch {
      // alias doesn't exist, install it
    }
    execSync(`git config alias.mmd '!f() { npx @safetnsr/md-kit mv "$1" "$2" && git add -A; }; f'`, { stdio: 'pipe' });
    process.stdout.write('installed git alias: use `git mmd <old> <new>` to move files with link updates\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * setup command — auto-configure for agent workspace
 */
function cmdSetup(opts?: ParsedArgs): number {
  const cwd = process.cwd();
  const markers = ['AGENTS.md', 'CLAUDE.md', 'HEARTBEAT.md', '.claude', '.openclaw'];
  const found = markers.some(m => existsSync(join(cwd, m)));

  if (!found) {
    process.stdout.write('no agent workspace detected (no AGENTS.md/CLAUDE.md/HEARTBEAT.md found)\n');
    return 0;
  }

  // Install hook (skip if already installed)
  const gitDir = join(cwd, '.git');
  let hookInstalled = false;
  if (existsSync(gitDir)) {
    const hookPath = join(gitDir, 'hooks', 'pre-commit');
    if (existsSync(hookPath)) {
      const hookContent = readFileSync(hookPath, 'utf-8');
      if (hookContent.includes('md-kit')) {
        // Already installed
      } else {
        cmdInstall();
        hookInstalled = true;
      }
    } else {
      cmdInstall();
      hookInstalled = true;
    }
  }

  // Install git alias
  let aliasInstalled = false;
  aliasInstalled = installGitAlias();

  // Update HEARTBEAT.md if it exists
  let heartbeatUpdated = false;
  const heartbeatPath = join(cwd, 'HEARTBEAT.md');
  if (existsSync(heartbeatPath)) {
    const content = readFileSync(heartbeatPath, 'utf-8');
    if (content.includes('md-kit check')) {
      // Already has md-kit check
    } else {
      // Count existing ### N. headers
      const stepMatches = content.match(/### \d+\./g);
      const nextN = stepMatches ? stepMatches.length + 1 : 1;
      const newStep = `\n### ${nextN}. md-kit check\n- Run \`npx @safetnsr/md-kit check . --json --quiet-if-clean --since yesterday\` — if \`critical > 0\`, report broken links to pablo\n`;
      appendFileSync(heartbeatPath, newStep);
      heartbeatUpdated = true;
    }
  }

  const parts: string[] = [];
  if (hookInstalled) parts.push('hook installed');
  if (aliasInstalled) parts.push('git alias installed');
  if (heartbeatUpdated) parts.push('heartbeat updated');
  if (parts.length === 0) parts.push('already configured');
  process.stdout.write(`md-kit setup complete: ${parts.join(', ')}\n`);
  return 0;
}

/**
 * Apply fixes to files, return number of unique files changed
 */
function applyFixes(baseDir: string, fixable: BrokenLink[]): number {
  const fileEdits = new Map<string, BrokenLink[]>();
  for (const b of fixable) {
    const arr = fileEdits.get(b.file) || [];
    arr.push(b);
    fileEdits.set(b.file, arr);
  }

  for (const [file, edits] of fileEdits) {
    const filePath = resolve(baseDir, file);
    let content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const edit of edits) {
      const lineIdx = edit.line - 1;
      if (lineIdx < lines.length) {
        const newRaw = edit.type === 'wikilink'
          ? edit.raw.replace(edit.target, edit.suggestion!)
          : edit.raw.replace(edit.target, edit.suggestion! + (edit.target.endsWith('.md') ? '.md' : ''));
        lines[lineIdx] = lines[lineIdx].replace(edit.raw, newRaw);
      }
    }

    writeFileSync(filePath, lines.join('\n'));
  }

  return fileEdits.size;
}

/**
 * watch command — filesystem daemon with rename detection + auto-fix
 */
function cmdWatch(opts: ParsedArgs): number {
  const baseDir = resolve(opts.dir);
  process.stdout.write(`watching ${opts.dir} for markdown changes... (Ctrl+C to stop)\n`);
  process.stdout.write(`tip: use \`md-kit mv\` or \`git mmd\` instead of mv/git mv to auto-update links\n`);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let renameDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastBrokenCount = -1;

  function onchange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const { files, allLinks, broken } = runCheck(baseDir, opts);
      const now = new Date().toISOString().slice(11, 19);

      if (broken.length > 0) {
        if (opts.json) {
          const report = { timestamp: now, ...formatJson(broken, files.length, allLinks.length) };
          process.stdout.write(JSON.stringify(report) + '\n');
        } else {
          process.stdout.write(`[${now}] ${broken.length} broken links found:\n`);
          for (const b of broken) {
            process.stdout.write(`  ${b.file}:${b.line}  ${b.raw}\n`);
          }
        }
        lastBrokenCount = broken.length;
      } else if (lastBrokenCount > 0) {
        process.stdout.write(`[${now}] ✓ all links healthy\n`);
        lastBrokenCount = 0;
      }
    }, 500);
  }

  function onRename() {
    if (renameDebounceTimer) clearTimeout(renameDebounceTimer);
    renameDebounceTimer = setTimeout(() => {
      const now = new Date().toISOString().slice(11, 19);
      process.stdout.write(`[${now}] rename detected — checking links...\n`);

      const { files, allLinks, broken } = runCheck(baseDir, opts);
      if (broken.length === 0) return;

      // Auto-fix links with exactly one suggestion
      const singleSuggestion = broken.filter(b => b.suggestion !== null);
      if (singleSuggestion.length > 0) {
        const fixed = applyFixes(baseDir, singleSuggestion);
        for (const b of singleSuggestion) {
          const newRaw = b.type === 'wikilink'
            ? b.raw.replace(b.target, b.suggestion!)
            : b.raw.replace(b.target, b.suggestion! + (b.target.endsWith('.md') ? '.md' : ''));
          process.stdout.write(`[${now}] auto-fixed: ${b.raw} → ${newRaw} in ${b.file}:${b.line}\n`);
        }
        lastBrokenCount = 0;
      }

      // Report remaining unfixable
      const noSuggestion = broken.filter(b => b.suggestion === null);
      if (noSuggestion.length > 0) {
        process.stdout.write(`[${now}] ${noSuggestion.length} broken links need manual fix:\n`);
        for (const b of noSuggestion) {
          process.stdout.write(`  ${b.file}:${b.line}  ${b.raw}\n`);
        }
        lastBrokenCount = noSuggestion.length;
      }
    }, 500);
  }

  try {
    watch(baseDir, { recursive: true }, (event, filename) => {
      if (filename && filename.endsWith('.md')) {
        if (event === 'rename') {
          onRename();
        } else {
          onchange();
        }
      }
    });
  } catch (e: any) {
    process.stderr.write(`Error watching ${baseDir}: ${e.message}\n`);
    return 1;
  }

  return 0;
}

/**
 * pipe command — md-pipe functionality (watch + pipeline automation)
 * Subcommands: init, watch, once, run, test
 */
async function cmdPipe(subArgs: string[]): Promise<number> {
  const sub = subArgs[0] || 'help';
  const rest = subArgs.slice(1);

  // Parse common pipe flags
  let configPath: string | undefined;
  let dryRun = false;
  let json = false;
  let verbose = false;
  let debug = false;
  let statePath: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--dry-run') { dryRun = true; }
    else if (a === '--json') { json = true; }
    else if (a === '--verbose') { verbose = true; }
    else if (a === '--debug') { debug = true; }
    else if ((a === '--config' || a === '-c') && i + 1 < rest.length) { configPath = rest[++i]; }
    else if (a === '--state' && i + 1 < rest.length) { statePath = rest[++i]; }
    else if (!a.startsWith('-')) { positionals.push(a); }
  }

  function getConfig() {
    const cwd = process.cwd();
    const cfgPath = configPath || findConfigFile(cwd);
    if (!cfgPath) {
      process.stderr.write('No .md-pipe.yml found. Run `md-kit pipe init` to create one.\n');
      process.exit(1);
    }
    return loadConfig(cfgPath);
  }

  function formatCmd(command: string): string {
    if (debug) return command;
    const first = command.split('\n')[0].trim();
    const truncated = first.length > 80 ? first.slice(0, 77) + '...' : first;
    return command.includes('\n') ? truncated + ' …' : truncated;
  }

  function formatPipeResult(result: PipelineResult): void {
    const status = result.success ? '✓' : '✗';
    process.stdout.write(`  ${status} Pipeline ${result.pipelineName} (${result.durationMs}ms)\n`);
    for (const step of result.steps) {
      const s = step.success ? '  ✓' : '  ✗';
      process.stdout.write(`    ${s} [${step.type}] ${step.stdout.split('\n')[0].slice(0, 80)}\n`);
      if (step.stderr) {
        process.stdout.write(`      ${step.stderr.split('\n')[0]}\n`);
      }
    }
  }

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    process.stdout.write(`
md-kit pipe — markdown content pipelines

USAGE
  md-kit pipe init                   scaffold a .md-pipe.yml config file
  md-kit pipe watch                  start watching for changes
  md-kit pipe once                   run triggers against current files (CI/batch)
  md-kit pipe run <pipeline> [file]  manually trigger a pipeline on a file
  md-kit pipe test <file>            show which triggers/pipelines match a file

FLAGS
  --config, -c <path>   path to config file (default: .md-pipe.yml)
  --dry-run             show matches without executing actions
  --json                output in JSON format
  --verbose             show trigger + file + first line of command
  --debug               show full interpolated commands
  --state <path>        state file for idempotent once mode

CONFIG (.md-pipe.yml)
  watch: ./docs
  triggers:
    - name: publish
      match:
        path: "posts/**"
        frontmatter: { status: publish }
      run: "echo Publishing $FILE"
  pipelines:
    - name: publish-post
      trigger:
        path: "posts/**"
        frontmatter: { status: publish }
      steps:
        - run: "echo Publishing {{fm.title}}"
        - update-frontmatter: { published_at: "{{now}}" }
`.trim() + '\n');
    return 0;
  }

  if (sub === 'init') {
    const target = resolve(process.cwd(), '.md-pipe.yml');
    if (existsSync(target)) {
      process.stderr.write('.md-pipe.yml already exists. Delete it first to re-initialize.\n');
      return 1;
    }
    writeFileSync(target, generateDefaultConfig(), 'utf-8');
    process.stdout.write('created .md-pipe.yml\nedit the config, then run: md-kit pipe watch\n');
    return 0;
  }

  if (sub === 'watch') {
    const config = getConfig();
    if (!existsSync(config.watch)) {
      process.stderr.write(`watch directory not found: ${config.watch}\n`);
      return 1;
    }

    const watcher = new MdPipeWatcher(config, dryRun);

    watcher.on('ready', () => {
      process.stdout.write(`watching ${config.watch}\n`);
      if (config.triggers.length > 0) process.stdout.write(`  ${config.triggers.length} trigger(s)\n`);
      if (config.pipelines.length > 0) process.stdout.write(`  ${config.pipelines.length} pipeline(s)\n`);
      if (dryRun) process.stdout.write('  [dry-run mode — actions will not execute]\n');
      process.stdout.write('  press Ctrl+C to stop\n\n');
    });

    watcher.on('match', (result) => {
      if (json) return;
      const ts = new Date().toLocaleTimeString();
      process.stdout.write(`[${ts}] ▸ ${result.trigger.name} matched ${result.file.relativePath}\n`);
    });

    watcher.on('action', (result) => {
      if (json) { process.stdout.write(JSON.stringify(result) + '\n'); return; }
      const status = result.exitCode === 0 ? '✓' : `✗ exit ${result.exitCode}`;
      process.stdout.write(`  ${status} ${formatCmd(result.command)}\n`);
      if (result.stdout && (verbose || debug)) {
        process.stdout.write('    ' + result.stdout.replace(/\n/g, '\n    ') + '\n');
      }
      if (result.stderr) {
        process.stdout.write('    ' + result.stderr.replace(/\n/g, '\n    ') + '\n');
      }
    });

    watcher.on('pipeline', (result: PipelineResult) => {
      if (json) { process.stdout.write(JSON.stringify(result) + '\n'); return; }
      formatPipeResult(result);
    });

    watcher.on('error', (err, filePath) => {
      process.stderr.write(`Error${filePath ? ` (${filePath})` : ''}: ${err.message}\n`);
    });

    process.on('SIGINT', async () => {
      process.stdout.write('\nstopping watcher...\n');
      await watcher.stop();
      process.exit(0);
    });

    await watcher.start();
    return 0; // won't reach until SIGINT
  }

  if (sub === 'once') {
    const config = getConfig();
    if (!existsSync(config.watch)) {
      process.stderr.write(`watch directory not found: ${config.watch}\n`);
      return 1;
    }

    const result = runOnce(config, dryRun, statePath);

    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return result.errors.length > 0 ? 1 : 0;
    }

    process.stdout.write(`md-kit pipe once\n`);
    let summary = `  scanned ${result.total} files, ${result.matched} trigger match(es)`;
    if (result.skipped > 0) summary += `, ${result.skipped} skipped (unchanged)`;
    process.stdout.write(summary + '\n\n');

    if (dryRun) process.stdout.write('  [dry-run mode — actions were not executed]\n\n');

    for (const action of result.actions) {
      const status = action.exitCode === 0 ? '✓' : `✗ exit ${action.exitCode}`;
      process.stdout.write(`${status} ${action.triggerName} → ${formatCmd(action.command)}\n`);
      if (action.stdout && (verbose || debug)) process.stdout.write('  ' + action.stdout + '\n');
      if (action.stderr) process.stdout.write('  ' + action.stderr + '\n');
    }

    for (const err of result.errors) process.stderr.write(err + '\n');
    return result.errors.length > 0 ? 1 : 0;
  }

  if (sub === 'run') {
    const pipelineName = positionals[0];
    const filePath = positionals[1];

    if (!pipelineName) {
      process.stderr.write('Usage: md-kit pipe run <pipeline-name> [file]\n');
      return 1;
    }

    const config = getConfig();
    const result = await runPipelineCommand(config, pipelineName, filePath, dryRun);

    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return result.success ? 0 : 1;
    }

    process.stdout.write(`md-kit pipe run ${pipelineName}${filePath ? ` ${filePath}` : ''}\n\n`);

    for (const pr of result.results) {
      formatPipeResult(pr);
    }
    for (const err of result.errors) process.stderr.write(err + '\n');

    return result.success ? 0 : 1;
  }

  if (sub === 'test') {
    const filePath = positionals[0];
    if (!filePath) {
      process.stderr.write('Usage: md-kit pipe test <file>\n');
      return 1;
    }

    const config = getConfig();
    let result;
    try {
      result = testFile(config, filePath);
    } catch (e: any) {
      process.stderr.write(`Error: ${e.message}\n`);
      return 1;
    }

    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return 0;
    }

    process.stdout.write(`testing: ${result.relativePath}\n`);
    process.stdout.write(`  frontmatter: ${JSON.stringify(result.frontmatter)}\n`);
    process.stdout.write(`  tags: [${result.tags.join(', ')}]\n\n`);

    if (result.matches.length === 0) {
      process.stdout.write('  no triggers or pipelines matched this file.\n');
      return 0;
    }

    for (const m of result.matches) {
      const label = m.type === 'pipeline' ? '[pipeline]' : '[trigger]';
      process.stdout.write(`  ✓ ${label} ${m.triggerName}: ${m.reason}\n`);
    }

    return 0;
  }

  process.stderr.write(`unknown pipe subcommand: ${sub}\nRun md-kit pipe --help for usage.\n`);
  return 1;
}

export function main(argv: string[] = process.argv): number {
  const opts = parseArgs(argv);

  if (opts.help || (!opts.command && !opts.version)) {
    process.stdout.write(HELP.trim() + '\n');
    return 0;
  }

  if (opts.version) {
    process.stdout.write(`md-kit v${VERSION}\n`);
    return 0;
  }

  if (opts.command === 'install') {
    return cmdInstall();
  }

  if (opts.command === 'setup') {
    return cmdSetup(opts);
  }

  if (opts.command === 'ignore') {
    return cmdIgnore(opts);
  }

  if (opts.gitAlias) {
    installGitAlias();
  }

  if (opts.command === 'mv') {
    return cmdMv(opts);
  }

  if (opts.command === 'fix') {
    return cmdFix(opts);
  }

  if (opts.command === 'watch') {
    return cmdWatch(opts);
  }

  if (opts.command === 'pipe') {
    // pipe is async — must be handled via runAsync
    return -999; // sentinel: handled by runAsync
  }

  if (opts.command !== 'check') {
    process.stderr.write(`Unknown command: ${opts.command}\nRun md-kit --help for usage.\n`);
    return 1;
  }

  const baseDir = resolve(opts.dir);
  const { files, allLinks, broken, ignoredCount } = runCheck(baseDir, opts);

  // Apply --since filter
  let filteredBroken = broken;
  if (opts.since) {
    const sinceDate = parseSinceDate(opts.since);
    filteredBroken = broken.filter(b => {
      const lastMod = getLastModified(b.file, baseDir);
      if (!lastMod) return false; // untracked files excluded when --since is used
      return lastMod >= sinceDate;
    });
  }

  if (files.length === 0) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ totalFiles: 0, totalLinks: 0, brokenLinks: 0, broken_count: 0, critical: 0, warnings: 0, info: 0, ignored_count: 0, results: [] }, null, 2) + '\n');
    } else if (!opts.quietIfClean) {
      process.stdout.write('No markdown files found.\n');
    }
    return 0;
  }

  // quiet-if-clean: no output when no broken links
  if (opts.quietIfClean && filteredBroken.length === 0) {
    return 0;
  }

  // Determine display level
  let displayLevel: DisplayLevel = 'critical';
  if (opts.full) displayLevel = 'full';
  else if (opts.warnings) displayLevel = 'warnings';

  // Output
  if (opts.json) {
    const report = formatJson(filteredBroken, files.length, allLinks.length, ignoredCount);
    if (filteredBroken.length > 0) {
      (report as any).tip = 'use `md-kit mv <old> <new>` to move files without breaking links';
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const output = formatTable(filteredBroken, files.length, allLinks.length, displayLevel);
    process.stdout.write(output + '\n');
    if (filteredBroken.length > 0 && !opts.quietIfClean) {
      process.stdout.write('tip: use `md-kit mv <old> <new>` instead of mv/git mv to auto-update links\n');
    }
  }

  return filteredBroken.length > 0 ? 1 : 0;
}

// Run
async function runAsync(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (opts.command === 'pipe') {
    const subArgs = process.argv.slice(3); // everything after 'pipe'
    const code = await cmdPipe(subArgs);
    if (code !== 0) process.exit(code);
    return;
  }
  const exitCode = main();
  if (exitCode !== 0) process.exit(exitCode);
}

runAsync().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
