import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface StateEntry {
  hash: string;
  processedAt: string;
}

export interface StateFile {
  version: 1;
  entries: Record<string, StateEntry>;
}

export function loadState(statePath: string): StateFile {
  if (!existsSync(statePath)) return { version: 1, entries: {} };
  try {
    const raw = readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.version === 1 && parsed.entries) return parsed;
    return { version: 1, entries: {} };
  } catch {
    return { version: 1, entries: {} };
  }
}

export function saveState(statePath: string, state: StateFile): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

export function computeFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function hasChanged(
  state: StateFile,
  triggerName: string,
  relativePath: string,
  content: string
): boolean {
  const key = `${triggerName}::${relativePath}`;
  const hash = computeFileHash(content);
  const existing = state.entries[key];
  return !existing || existing.hash !== hash;
}

export function markProcessed(
  state: StateFile,
  triggerName: string,
  relativePath: string,
  content: string
): void {
  const key = `${triggerName}::${relativePath}`;
  state.entries[key] = {
    hash: computeFileHash(content),
    processedAt: new Date().toISOString(),
  };
}
