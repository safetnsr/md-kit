import { readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { MdPipeConfig } from './config.js';
import { parseMarkdownFile, evaluateTrigger } from './matcher.js';
import { executeAction, type RunResult } from './runner.js';
import { loadState, saveState, hasChanged, markProcessed, type StateFile } from './state.js';

function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string): void {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

export interface OnceResult {
  total: number;
  matched: number;
  skipped: number;
  actions: RunResult[];
  errors: string[];
}

export function runOnce(
  config: MdPipeConfig,
  dryRun: boolean = false,
  statePath?: string
): OnceResult {
  const files = findMarkdownFiles(config.watch);
  const actions: RunResult[] = [];
  const errors: string[] = [];
  let matched = 0;
  let skipped = 0;

  let state: StateFile | null = null;
  if (statePath) state = loadState(statePath);

  for (const filePath of files) {
    const relativePath = relative(config.watch, filePath);

    let file;
    try {
      file = parseMarkdownFile(filePath, relativePath);
    } catch (err) {
      errors.push(`Error parsing ${filePath}: ${err}`);
      continue;
    }

    for (const trigger of config.triggers) {
      if (trigger.match.frontmatter_changed) continue;

      const match = evaluateTrigger(trigger, file);
      if (match) {
        if (state && !hasChanged(state, trigger.name, relativePath, file.content)) {
          skipped++;
          continue;
        }

        matched++;
        const result = executeAction(match, dryRun, config.configDir);
        actions.push(result);

        if (state && !dryRun) {
          markProcessed(state, trigger.name, relativePath, file.content);
        }
      }
    }
  }

  if (state && statePath && !dryRun) {
    saveState(statePath, state);
  }

  return { total: files.length, matched, skipped, actions, errors };
}
