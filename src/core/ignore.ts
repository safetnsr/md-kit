import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load ignore patterns from .mdkitignore file.
 * Each line is a glob pattern or exact link string to ignore.
 * Lines starting with # are comments.
 */
export function loadIgnorePatterns(baseDir: string): string[] {
  const ignorePath = join(baseDir, '.mdkitignore');
  if (!existsSync(ignorePath)) return [];
  return readFileSync(ignorePath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

/**
 * Check if a link matches any ignore pattern.
 * Supports exact match and simple * wildcard.
 */
export function isIgnored(link: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    if (pattern === link) return true;
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(link);
    }
    return false;
  });
}

/**
 * Add a pattern to .mdkitignore.
 */
export function addIgnorePattern(pattern: string, baseDir: string): void {
  const ignorePath = join(baseDir, '.mdkitignore');
  appendFileSync(ignorePath, `${pattern}\n`);
}
