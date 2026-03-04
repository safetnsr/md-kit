import { readFileSync } from 'node:fs';
import { isMatch } from './glob.js';
import { parseFrontmatter } from './frontmatter.js';
import type { TriggerDef, TriggerMatch } from './config.js';

export interface FileState {
  filePath: string;
  relativePath: string;
  content: string;
  body: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
}

export interface MatchResult {
  trigger: TriggerDef;
  file: FileState;
  diff: Record<string, { old: unknown; new: unknown }> | null;
}

export function parseMarkdownFile(filePath: string, relativePath: string): FileState {
  const raw = readFileSync(filePath, 'utf-8');
  return parseMarkdownContent(raw, filePath, relativePath);
}

export function parseMarkdownContent(content: string, filePath: string, relativePath: string): FileState {
  let frontmatter: Record<string, unknown> = {};
  let tags: string[] = [];
  let body = content;

  try {
    const parsed = parseFrontmatter(content);
    frontmatter = (parsed.data as Record<string, unknown>) || {};
    body = parsed.content || '';
    if (Array.isArray(frontmatter['tags'])) {
      tags = (frontmatter['tags'] as unknown[]).map(String);
    }
  } catch {
    // File has no valid frontmatter — that's fine
  }

  return { filePath, relativePath, content, body, frontmatter, tags };
}

export function matchPath(relativePath: string, pattern: string): boolean {
  return isMatch(relativePath, pattern);
}

export function matchFrontmatter(
  frontmatter: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean {
  for (const [key, val] of Object.entries(expected)) {
    const actual = frontmatter[key];

    if (typeof val === 'string' && val.startsWith('!')) {
      const negated = val.slice(1);
      if (actual === undefined) continue;
      if (String(actual) === negated) return false;
      continue;
    }

    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
      if (!matchFrontmatter(actual as Record<string, unknown>, val as Record<string, unknown>)) return false;
    } else if (Array.isArray(val)) {
      if (!Array.isArray(actual)) return false;
      for (const item of val) {
        if (!(actual as unknown[]).includes(item)) return false;
      }
    } else {
      if (String(actual) !== String(val)) return false;
    }
  }
  return true;
}

export function matchTags(fileTags: string[], requiredTags: string[]): boolean {
  const normalized = fileTags.map(t => t.replace(/^#/, '').toLowerCase());
  return requiredTags.every(tag => {
    const norm = tag.replace(/^#/, '').toLowerCase();
    return normalized.includes(norm);
  });
}

export function matchContent(body: string, substring: string): boolean {
  return body.includes(substring);
}

export function matchContentRegex(body: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(body);
  } catch {
    return false;
  }
}

export function computeFrontmatterDiff(
  oldFm: Record<string, unknown>,
  newFm: Record<string, unknown>,
  watchFields: string[]
): Record<string, { old: unknown; new: unknown }> | null {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of watchFields) {
    const oldVal = oldFm[field];
    const newVal = newFm[field];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[field] = { old: oldVal ?? null, new: newVal ?? null };
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

export function evaluateTrigger(
  trigger: TriggerDef,
  file: FileState,
  previousFrontmatter?: Record<string, unknown>
): MatchResult | null {
  const { match } = trigger;
  let diff: Record<string, { old: unknown; new: unknown }> | null = null;

  if (match.path) {
    if (!matchPath(file.relativePath, match.path)) return null;
  }

  if (match.frontmatter) {
    if (!matchFrontmatter(file.frontmatter, match.frontmatter)) return null;
  }

  if (match.tags) {
    if (!matchTags(file.tags, match.tags)) return null;
  }

  if (match.content) {
    if (!matchContent(file.body, match.content)) return null;
  }

  if (match.content_regex) {
    if (!matchContentRegex(file.body, match.content_regex)) return null;
  }

  if (match.frontmatter_changed) {
    if (!previousFrontmatter) {
      diff = {};
      for (const field of match.frontmatter_changed) {
        if (file.frontmatter[field] !== undefined) {
          diff[field] = { old: null, new: file.frontmatter[field] };
        }
      }
      if (Object.keys(diff).length === 0) return null;
    } else {
      diff = computeFrontmatterDiff(previousFrontmatter, file.frontmatter, match.frontmatter_changed);
      if (!diff) return null;
    }
  }

  return { trigger, file, diff };
}
