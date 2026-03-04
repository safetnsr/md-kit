/**
 * Minimal glob matching — replaces micromatch.
 * Uses Node 21+ path.matchesGlob when available, falls back to regex.
 * Zero external dependencies.
 */

import { matchesGlob } from 'node:path';

/**
 * Test if a path matches a glob pattern.
 * Supports: **, *, ?, character classes [abc], and negation !
 */
export function isMatch(filePath: string, pattern: string): boolean {
  // Normalize slashes
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Use Node's built-in matchesGlob (available since Node 21)
  try {
    return matchesGlob(normalizedPath, normalizedPattern);
  } catch {
    // Fallback: simple glob-to-regex
    return globToRegex(normalizedPattern).test(normalizedPath);
  }
}

/**
 * Convert a glob pattern to a RegExp.
 * Fallback for environments without path.matchesGlob.
 */
function globToRegex(pattern: string): RegExp {
  let regStr = '^';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches anything including /
        regStr += '.*';
        i += 2;
        // Skip following /
        if (pattern[i] === '/') i++;
      } else {
        // * matches anything except /
        regStr += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regStr += '[^/]';
      i++;
    } else if (ch === '[') {
      // Character class
      const end = pattern.indexOf(']', i);
      if (end === -1) {
        regStr += '\\[';
        i++;
      } else {
        regStr += pattern.slice(i, end + 1);
        i = end + 1;
      }
    } else if ('.+^${}()|\\'.includes(ch)) {
      regStr += '\\' + ch;
      i++;
    } else {
      regStr += ch;
      i++;
    }
  }
  regStr += '$';
  return new RegExp(regStr);
}
