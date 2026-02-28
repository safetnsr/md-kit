import { BrokenLink } from './resolver.js';
import { Severity } from './severity.js';

// ANSI color codes (zero dependency)
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const MAGENTA = '\x1b[35m';

export type DisplayLevel = 'critical' | 'warnings' | 'full';

export interface JsonReport {
  totalFiles: number;
  totalLinks: number;
  brokenLinks: number;
  broken_count: number;
  critical: number;
  warnings: number;
  info: number;
  ignored_count: number;
  results: Array<{
    file: string;
    line: number;
    link: string;
    type: string;
    severity: Severity;
    suggestion: string | null;
  }>;
}

function severityCounts(broken: BrokenLink[]): { critical: number; warnings: number; info: number } {
  let critical = 0, warnings = 0, info = 0;
  for (const b of broken) {
    if (b.severity === 'critical') critical++;
    else if (b.severity === 'warning') warnings++;
    else info++;
  }
  return { critical, warnings, info };
}

function severityColor(s: Severity): string {
  if (s === 'critical') return RED;
  if (s === 'warning') return YELLOW;
  return DIM;
}

/**
 * Format broken links as a colored table for terminal output.
 * By default only shows critical items. Use displayLevel to show more.
 */
export function formatTable(
  broken: BrokenLink[],
  totalFiles: number,
  totalLinks: number,
  displayLevel: DisplayLevel = 'critical'
): string {
  if (broken.length === 0) {
    return `${GREEN}✓${RESET} ${totalFiles} files scanned, ${totalLinks} links checked — ${GREEN}all links valid${RESET}`;
  }

  const counts = severityCounts(broken);
  const lines: string[] = [];

  // Summary header
  lines.push('');
  lines.push(`${BOLD}md-kit: ${broken.length} broken links${RESET} (${RED}${counts.critical} critical${RESET}, ${YELLOW}${counts.warnings} warnings${RESET}, ${DIM}${counts.info} info${RESET})`);
  if (displayLevel === 'critical' && (counts.warnings > 0 || counts.info > 0)) {
    lines.push(`run with ${CYAN}--full${RESET} to see all, or ${CYAN}--warnings${RESET} to include warnings`);
  }
  lines.push('');

  // Filter based on display level
  let filtered: BrokenLink[];
  if (displayLevel === 'full') {
    filtered = broken;
  } else if (displayLevel === 'warnings') {
    filtered = broken.filter(b => b.severity === 'critical' || b.severity === 'warning');
  } else {
    filtered = broken.filter(b => b.severity === 'critical');
  }

  if (filtered.length > 0) {
    // Header
    lines.push(`${BOLD}  FILE${' '.repeat(30)}BROKEN LINK${' '.repeat(19)}SEVERITY${' '.repeat(4)}TYPE${' '.repeat(8)}SUGGESTION${RESET}`);
    lines.push(`${DIM}  ${'─'.repeat(100)}${RESET}`);

    for (const link of filtered) {
      const file = truncate(`${link.file}:${link.line}`, 34);
      const target = truncate(link.raw, 28);
      const sevColor = severityColor(link.severity);
      const sev = `${sevColor}${link.severity}${RESET}`;
      const sevPad = ' '.repeat(Math.max(1, 12 - link.severity.length));
      const type = link.type === 'wikilink' ? `${CYAN}wiki${RESET}` : `${YELLOW}rel${RESET}`;
      const typePad = ' '.repeat(8);
      const suggestion = link.suggestion ? `${GREEN}${link.suggestion}${RESET}` : `${DIM}—${RESET}`;

      lines.push(`  ${RED}${file}${RESET}${pad(file, 35)}${target}${pad(target, 30)}${sev}${sevPad}${type}${typePad}${suggestion}`);
    }
  }

  // Footer with hidden counts
  const hiddenWarnings = displayLevel === 'critical' ? counts.warnings : 0;
  const hiddenInfo = displayLevel !== 'full' ? counts.info : 0;
  const hiddenParts: string[] = [];
  if (hiddenWarnings > 0) hiddenParts.push(`${hiddenWarnings} more warnings`);
  if (hiddenInfo > 0) hiddenParts.push(`${hiddenInfo} info`);

  if (hiddenParts.length > 0) {
    lines.push('');
    lines.push(`${DIM}  ... (${hiddenParts.join(', ')} — run --full to see all)${RESET}`);
  }

  lines.push('');
  lines.push(`${RED}✗${RESET} ${totalFiles} files scanned, ${totalLinks} links checked — ${RED}${broken.length} broken${RESET}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format broken links as JSON
 */
export function formatJson(broken: BrokenLink[], totalFiles: number, totalLinks: number, ignoredCount: number = 0): JsonReport {
  const counts = severityCounts(broken);
  return {
    totalFiles,
    totalLinks,
    brokenLinks: broken.length,
    broken_count: broken.length,
    critical: counts.critical,
    warnings: counts.warnings,
    info: counts.info,
    ignored_count: ignoredCount,
    results: broken.map(b => ({
      file: b.file,
      line: b.line,
      link: b.target,
      type: b.type,
      severity: b.severity,
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
