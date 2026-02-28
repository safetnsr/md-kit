import { execSync } from 'node:child_process';
import { join } from 'node:path';

export type Severity = 'critical' | 'warning' | 'info';

/**
 * Get last commit timestamp for a file (in days ago).
 * Returns Infinity if file has never been committed or git not available.
 */
export function getDaysAgo(filePath: string, baseDir: string): number {
  try {
    const result = execSync(
      `git -C "${baseDir}" log -1 --format="%ct" -- "${filePath}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 2000 }
    ).trim();
    if (!result) return Infinity;
    const timestamp = parseInt(result, 10);
    const now = Math.floor(Date.now() / 1000);
    return Math.floor((now - timestamp) / 86400);
  } catch {
    return Infinity;
  }
}

/**
 * Classify severity based on how recently the file was modified.
 * critical: < 30 days
 * warning: 30-90 days
 * info: > 90 days or never committed
 */
export function getSeverity(filePath: string, baseDir: string): Severity {
  const days = getDaysAgo(filePath, baseDir);
  if (days < 30) return 'critical';
  if (days <= 90) return 'warning';
  return 'info';
}

/**
 * Get last modified date for a file from git.
 * Returns null if file has never been committed or git not available.
 */
export function getLastModified(filePath: string, baseDir: string): Date | null {
  try {
    const result = execSync(
      `git -C "${baseDir}" log -1 --format="%ct" -- "${filePath}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 2000 }
    ).trim();
    if (!result) return null;
    return new Date(parseInt(result, 10) * 1000);
  } catch {
    return null;
  }
}

/**
 * Parse a --since date string into a Date object.
 * Supports: 'yesterday', '7days', '30days', 'YYYY-MM-DD'
 */
export function parseSinceDate(since: string): Date {
  if (since === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }
  const daysMatch = since.match(/^(\d+)days?$/);
  if (daysMatch) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(daysMatch[1]));
    return d;
  }
  return new Date(since); // YYYY-MM-DD
}
