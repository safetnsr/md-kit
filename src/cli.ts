#!/usr/bin/env node

import { resolve } from 'node:path';
import { findMarkdownFiles, extractLinks, readFile } from './core/scanner.js';
import { findBrokenLinks } from './core/resolver.js';
import { formatTable, formatJson } from './core/reporter.js';

const VERSION = '0.1.0';

const HELP = `
md-kit — find broken [[wikilinks]] and dead relative links in any markdown workspace

USAGE
  md-kit check [dir]       scan directory for broken links (default: .)
  md-kit --help             show this help
  md-kit --version          show version

FLAGS
  --json                   output as JSON (agent interface)
  --ignore <pattern>       glob pattern to ignore (repeatable)

EXAMPLES
  npx @safetnsr/md-kit check .
  npx @safetnsr/md-kit check ./docs --json
  md-kit check memory/
`;

function parseArgs(argv: string[]): {
  command: string;
  dir: string;
  json: boolean;
  ignore: string[];
  help: boolean;
  version: boolean;
} {
  const args = argv.slice(2);
  let command = '';
  let dir = '.';
  let json = false;
  const ignore: string[] = [];
  let help = false;
  let version = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version' || arg === '-v') {
      version = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--ignore' && i + 1 < args.length) {
      ignore.push(args[++i]);
    } else if (!command && !arg.startsWith('-')) {
      command = arg;
    } else if (command && !arg.startsWith('-')) {
      dir = arg;
    }
  }

  return { command, dir, json, ignore, help, version };
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

  if (opts.command !== 'check') {
    process.stderr.write(`Unknown command: ${opts.command}\nRun md-kit --help for usage.\n`);
    return 1;
  }

  const baseDir = resolve(opts.dir);

  // Find all markdown files
  const files = findMarkdownFiles(baseDir);

  if (files.length === 0) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ totalFiles: 0, totalLinks: 0, brokenLinks: 0, results: [] }, null, 2) + '\n');
    } else {
      process.stdout.write('No markdown files found.\n');
    }
    return 0;
  }

  // Extract all links
  const allLinks = [];
  for (const file of files) {
    const content = readFile(resolve(baseDir, file));
    if (content !== null) {
      allLinks.push(...extractLinks(file, content));
    }
  }

  // Filter ignored patterns
  let filteredLinks = allLinks;
  if (opts.ignore.length > 0) {
    filteredLinks = allLinks.filter(link => {
      return !opts.ignore.some(pattern => link.file.includes(pattern) || link.target.includes(pattern));
    });
  }

  // Find broken links
  const broken = findBrokenLinks(filteredLinks, files, baseDir);

  // Output
  if (opts.json) {
    const report = formatJson(broken, files.length, filteredLinks.length);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const output = formatTable(broken, files.length, filteredLinks.length);
    process.stdout.write(output + '\n');
  }

  return broken.length > 0 ? 1 : 0;
}

// Run
const exitCode = main();
process.exit(exitCode);
