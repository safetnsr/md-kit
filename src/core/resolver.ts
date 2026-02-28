import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ExtractedLink } from './scanner.js';

export interface BrokenLink extends ExtractedLink {
  suggestion: string | null;
}

/**
 * Simple Levenshtein distance
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Find the best fuzzy match for a target among known files
 */
function findSuggestion(target: string, allFiles: string[]): string | null {
  const targetLower = target.toLowerCase();
  let bestMatch: string | null = null;
  let bestDist = Infinity;

  for (const file of allFiles) {
    // Compare against filename without extension and full relative path
    const baseName = file.replace(/\.md$/, '');
    const baseNameOnly = baseName.split('/').pop() ?? baseName;

    const dist = Math.min(
      levenshtein(targetLower, baseNameOnly.toLowerCase()),
      levenshtein(targetLower, baseName.toLowerCase())
    );

    if (dist < bestDist && dist <= Math.max(3, Math.floor(target.length * 0.4))) {
      bestDist = dist;
      bestMatch = baseNameOnly;
    }
  }

  return bestMatch;
}

/**
 * Resolve a wikilink against the list of known .md files
 */
function resolveWikilink(target: string, allFiles: string[]): boolean {
  const targetLower = target.toLowerCase();
  return allFiles.some(f => {
    const baseName = f.replace(/\.md$/, '');
    const baseNameOnly = baseName.split('/').pop() ?? baseName;
    return baseNameOnly.toLowerCase() === targetLower || baseName.toLowerCase() === targetLower;
  });
}

/**
 * Resolve a relative link against the filesystem
 */
function resolveRelativeLink(target: string, fromFile: string, baseDir: string): boolean {
  const dir = dirname(join(baseDir, fromFile));
  const resolved = join(dir, target);
  return existsSync(resolved);
}

/**
 * Check all extracted links, return broken ones with suggestions
 */
export function findBrokenLinks(
  links: ExtractedLink[],
  allFiles: string[],
  baseDir: string
): BrokenLink[] {
  const broken: BrokenLink[] = [];

  for (const link of links) {
    let isValid = false;

    if (link.type === 'wikilink') {
      isValid = resolveWikilink(link.target, allFiles);
    } else {
      isValid = resolveRelativeLink(link.target, link.file, baseDir);
    }

    if (!isValid) {
      broken.push({
        ...link,
        suggestion: findSuggestion(link.target, allFiles),
      });
    }
  }

  return broken;
}
