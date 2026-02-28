import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { resolve, relative, dirname, basename, join } from 'node:path';
import { findMarkdownFiles, extractLinks, readFile } from './scanner.js';

export interface LinkUpdate {
  file: string;
  line: number;
  oldRaw: string;
  newRaw: string;
}

export interface MoveResult {
  moved: boolean;
  old: string;
  new: string;
  links_updated: number;
  files_updated: string[];
  updates: LinkUpdate[];
}

/**
 * Move a markdown file and update all incoming links across the workspace.
 */
export function moveFile(
  baseDir: string,
  oldPath: string,
  newPath: string,
  opts: { dryRun?: boolean; json?: boolean } = {}
): MoveResult {
  const absOld = resolve(baseDir, oldPath);
  const absNew = resolve(baseDir, newPath);

  if (!existsSync(absOld)) {
    throw new Error(`source does not exist: ${oldPath}`);
  }
  if (existsSync(absNew)) {
    throw new Error(`destination already exists: ${newPath}`);
  }

  // Derive the old "name" for wikilink matching
  const oldBaseName = basename(oldPath, '.md'); // e.g. "lessons"
  const oldRelNoExt = oldPath.replace(/\.md$/, ''); // e.g. "memory/lessons"
  const newBaseName = basename(newPath, '.md');
  const newRelNoExt = newPath.replace(/\.md$/, '');

  // Find all md files
  const allFiles = findMarkdownFiles(baseDir);
  const updates: LinkUpdate[] = [];

  for (const file of allFiles) {
    const filePath = resolve(baseDir, file);
    const content = readFile(filePath);
    if (content === null) continue;

    const lines = content.split('\n');
    let fileChanged = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let lineChanged = false;

      // Match [[wikilinks]]
      const wikiRe = /(?<!!)\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]*?))?\]\]/g;
      let match;
      while ((match = wikiRe.exec(line)) !== null) {
        const target = match[1].trim();
        const targetLower = target.toLowerCase();
        // Check if this wikilink points to the old file
        if (
          targetLower === oldBaseName.toLowerCase() ||
          targetLower === oldRelNoExt.toLowerCase()
        ) {
          // Build new wikilink - use path-style if original used path, otherwise use basename
          const usePath = target.includes('/');
          const newTarget = usePath ? newRelNoExt : newBaseName;
          const oldRaw = match[0];
          // Reconstruct: preserve alias and anchor
          const anchor = match[0].match(/#([^\]|]*)/)?.[0] ?? '';
          const alias = match[2] !== undefined ? `|${match[2]}` : '';
          const newRaw = `[[${newTarget}${anchor}${alias}]]`;

          if (oldRaw !== newRaw) {
            updates.push({ file, line: i + 1, oldRaw, newRaw });
            line = line.replace(oldRaw, newRaw);
            lineChanged = true;
          }
        }
      }

      // Match [text](relative-path) links
      const relRe = /\[([^\]]*)\]\(([^)]+)\)/g;
      while ((match = relRe.exec(lines[i])) !== null) {
        const href = match[2].trim();
        if (/^(https?:|mailto:|#|data:)/.test(href)) continue;

        const hrefPath = href.split('#')[0];
        const anchor = href.includes('#') ? '#' + href.split('#').slice(1).join('#') : '';
        if (!hrefPath) continue;

        // Resolve the href relative to the file's directory
        const fileDir = dirname(file);
        const resolvedHref = join(fileDir, hrefPath);
        // Normalize for comparison
        const normalizedOld = oldPath.replace(/\\/g, '/');
        const normalizedHref = resolvedHref.replace(/\\/g, '/');

        if (normalizedHref === normalizedOld) {
          // Calculate new relative path from this file to the new location
          const newRelative = relative(fileDir, newPath).replace(/\\/g, '/');
          const newHref = (newRelative.startsWith('.') ? newRelative : './' + newRelative).replace(/^\.\//, '') + anchor;
          // Actually keep it simple - just use relative
          const simpleRel = relative(fileDir, newPath).replace(/\\/g, '/') || basename(newPath);
          const finalHref = simpleRel + anchor;

          const oldRaw = match[0];
          const newRaw = `[${match[1]}](${finalHref})`;

          if (oldRaw !== newRaw) {
            updates.push({ file, line: i + 1, oldRaw, newRaw });
            line = line.replace(oldRaw, newRaw);
            lineChanged = true;
          }
        }
      }

      if (lineChanged) {
        lines[i] = line;
        fileChanged = true;
      }
    }

    if (fileChanged && !opts.dryRun) {
      writeFileSync(filePath, lines.join('\n'));
    }
  }

  // Move the file
  if (!opts.dryRun) {
    const newDir = dirname(absNew);
    mkdirSync(newDir, { recursive: true });
    try {
      renameSync(absOld, absNew);
    } catch {
      copyFileSync(absOld, absNew);
      unlinkSync(absOld);
    }
  }

  const filesUpdated = [...new Set(updates.map(u => u.file))];

  return {
    moved: !opts.dryRun,
    old: oldPath,
    new: newPath,
    links_updated: updates.length,
    files_updated: filesUpdated,
    updates,
  };
}
