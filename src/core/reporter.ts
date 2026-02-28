import { BrokenLink } from './resolver.js';

// ANSI color codes (zero dependency)
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';

export interface JsonReport {
  totalFiles: number;
  totalLinks: number;
  brokenLinks: number;
  results: Array<{
    file: string;
    line: number;
    link: string;
    type: string;
    suggestion: string | null;
  }>;
}

/**
 * Format broken links as a colored table for terminal output
 */
export function formatTable(broken: BrokenLink[], totalFiles: number, totalLinks: number): string {
  if (broken.length === 0) {
    return `${GREEN}✓${RESET} ${totalFiles} files scanned, ${totalLinks} links checked — ${GREEN}all links valid${RESET}`;
  }

  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(`${BOLD}  FILE${' '.repeat(30)}BROKEN LINK${' '.repeat(19)}TYPE${' '.repeat(8)}SUGGESTION${RESET}`);
  lines.push(`${DIM}  ${'─'.repeat(90)}${RESET}`);

  for (const link of broken) {
    const file = truncate(link.file, 34);
    const target = truncate(link.raw, 28);
    const type = link.type === 'wikilink' ? `${CYAN}wikilink${RESET}` : `${YELLOW}relative${RESET}`;
    const typePad = link.type === 'wikilink' ? ' '.repeat(4) : ' '.repeat(4);
    const suggestion = link.suggestion ? `${GREEN}${link.suggestion}${RESET}` : `${DIM}—${RESET}`;

    lines.push(`  ${RED}${file}${RESET}${pad(file, 35)}${target}${pad(target, 30)}${type}${typePad}${suggestion}`);
  }

  lines.push('');
  lines.push(`${RED}✗${RESET} ${totalFiles} files scanned, ${totalLinks} links checked — ${RED}${broken.length} broken${RESET}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format broken links as JSON
 */
export function formatJson(broken: BrokenLink[], totalFiles: number, totalLinks: number): JsonReport {
  return {
    totalFiles,
    totalLinks,
    brokenLinks: broken.length,
    results: broken.map(b => ({
      file: b.file,
      line: b.line,
      link: b.target,
      type: b.type,
      suggestion: b.suggestion,
    })),
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function pad(s: string, width: number): string {
  // Strip ANSI for length calculation
  const clean = s.replace(/\x1b\[[0-9;]*m/g, '');
  const spaces = Math.max(1, width - clean.length);
  return ' '.repeat(spaces);
}
