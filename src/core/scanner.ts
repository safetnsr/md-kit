import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface ExtractedLink {
  file: string;
  line: number;
  raw: string;
  target: string;
  type: 'wikilink' | 'relative';
}

/**
 * Recursively find all .md files in a directory
 */
export function findMarkdownFiles(dir: string, baseDir?: string): string[] {
  const base = baseDir ?? dir;
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...findMarkdownFiles(full, base));
    } else if (entry.endsWith('.md')) {
      results.push(relative(base, full));
    }
  }

  return results;
}

/**
 * Extract all [[wikilinks]] and [text](relative-path) links from a markdown file
 */
export function extractLinks(filePath: string, content: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match [[wikilinks]] — but not ![[embeds]] image syntax
    const wikiRe = /(?<!!)\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*?)?\]\]/g;
    let match;
    while ((match = wikiRe.exec(line)) !== null) {
      links.push({
        file: filePath,
        line: i + 1,
        raw: match[0],
        target: match[1].trim(),
        type: 'wikilink',
      });
    }

    // Match [text](relative-path) — skip http/https/mailto URLs and anchors
    const relRe = /\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = relRe.exec(line)) !== null) {
      const href = match[2].trim();
      // Skip external URLs, anchors, and data URIs
      if (/^(https?:|mailto:|#|data:)/.test(href)) continue;
      // Strip anchor from path
      const target = href.split('#')[0];
      if (!target) continue;
      links.push({
        file: filePath,
        line: i + 1,
        raw: match[0],
        target,
        type: 'relative',
      });
    }
  }

  return links;
}

/**
 * Read file content safely
 */
export function readFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}
