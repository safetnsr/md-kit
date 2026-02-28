#!/usr/bin/env node

import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, chmodSync, watch } from 'node:fs';
import { findMarkdownFiles, extractLinks, readFile } from './core/scanner.js';
import { findBrokenLinks, BrokenLink } from './core/resolver.js';
import { formatTable, formatJson } from './core/reporter.js';
import { moveFile } from './core/mover.js';

const VERSION = '0.3.0';

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
  md-kit install                install pre-commit git hook
  md-kit setup                  auto-configure for agent workspace

FLAGS
  --json                   output as JSON (agent interface)
  --ignore <pattern>       glob pattern to ignore (repeatable)
  --apply                  (fix only) apply fixes to files
  --patch                  (fix only) write fixes to md-kit-fixes.md
  --dry-run                (mv only) preview without moving
  --quiet-if-clean         (check only) no output if no broken links found
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
  positionals: string[];
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
    } else if (arg === '--ignore' && i + 1 < args.length) {
      ignore.push(args[++i]);
    } else if (!command && !arg.startsWith('-')) {
      command = arg;
    } else if (command && !arg.startsWith('-')) {
      positionals.push(arg);
      if (command !== 'mv') {
        dir = arg;
      }
    }
  }

  // For mv command, positionals are [old, new]
  // For other commands, first positional is dir
  if (command === 'mv') {
    // dir not used for mv
  }

  return { command, dir, json, ignore, help, version, apply, patch, dryRun, quietIfClean, positionals };
}

/**
 * Core check logic reused by check, fix, and watch
 */
function runCheck(baseDir: string, opts: { ignore: string[] }): {
  files: string[];
  allLinks: ReturnType<typeof extractLinks>;
  broken: BrokenLink[];
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

  const broken = findBrokenLinks(filteredLinks, files, baseDir);
  return { files, allLinks: filteredLinks, broken };
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
# md-kit pre-commit hook — checks for broken wikilinks on md file changes
CHANGED=$(git diff --cached --name-only --diff-filter=ADMR | grep '\\.md$')
if [ -n "$CHANGED" ]; then
  npx @safetnsr/md-kit check . --quiet-if-clean
  exit $?
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
 * setup command — auto-configure for agent workspace
 */
function cmdSetup(): number {
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
      const newStep = `\n### ${nextN}. md-kit check\n- Run \`npx @safetnsr/md-kit check . --json --quiet-if-clean\` — if \`broken_count > 0\`, report broken links to pablo\n`;
      appendFileSync(heartbeatPath, newStep);
      heartbeatUpdated = true;
    }
  }

  const parts: string[] = [];
  if (hookInstalled) parts.push('hook installed');
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
 * watch command — filesystem daemon
 */
function cmdWatch(opts: ParsedArgs): number {
  const baseDir = resolve(opts.dir);
  process.stdout.write(`watching ${opts.dir} for markdown changes... (Ctrl+C to stop)\n`);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastBrokenCount = -1;

  function onchange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const { files, allLinks, broken } = runCheck(baseDir, opts);
      const now = new Date().toISOString().slice(11, 19);

      if (broken.length > 0) {
        if (opts.json) {
          const report = { timestamp: now, ...require('./core/reporter.js').formatJson(broken, files.length, allLinks.length) };
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

  try {
    watch(baseDir, { recursive: true }, (event, filename) => {
      if (filename && filename.endsWith('.md')) {
        onchange();
      }
    });
  } catch (e: any) {
    process.stderr.write(`Error watching ${baseDir}: ${e.message}\n`);
    return 1;
  }

  return 0;
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
    return cmdSetup();
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

  if (opts.command !== 'check') {
    process.stderr.write(`Unknown command: ${opts.command}\nRun md-kit --help for usage.\n`);
    return 1;
  }

  const baseDir = resolve(opts.dir);
  const { files, allLinks, broken } = runCheck(baseDir, opts);

  if (files.length === 0) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ totalFiles: 0, totalLinks: 0, brokenLinks: 0, results: [] }, null, 2) + '\n');
    } else if (!opts.quietIfClean) {
      process.stdout.write('No markdown files found.\n');
    }
    return 0;
  }

  // quiet-if-clean: no output when no broken links
  if (opts.quietIfClean && broken.length === 0) {
    return 0;
  }

  // Output
  if (opts.json) {
    const report = formatJson(broken, files.length, allLinks.length);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const output = formatTable(broken, files.length, allLinks.length);
    process.stdout.write(output + '\n');
  }

  return broken.length > 0 ? 1 : 0;
}

// Run
const exitCode = main();
if (exitCode !== 0) process.exit(exitCode);
