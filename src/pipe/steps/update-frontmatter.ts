import { readFileSync, writeFileSync } from 'node:fs';
import { expandDeep, type TemplateContext } from '../template-vars.js';
import { parseFrontmatter, stringifyFrontmatter } from '../frontmatter.js';
import type { StepResult } from './run.js';

export interface UpdateFrontmatterStepConfig {
  'update-frontmatter': Record<string, unknown>;
}

export function executeUpdateFrontmatterStep(
  config: UpdateFrontmatterStepConfig,
  ctx: TemplateContext,
  dryRun: boolean
): StepResult {
  const updates = expandDeep(config['update-frontmatter'], ctx) as Record<string, unknown>;
  const start = Date.now();

  try {
    const raw = readFileSync(ctx.file, 'utf-8');
    const parsed = parseFrontmatter(raw);
    const fm = { ...parsed.data } as Record<string, unknown>;

    for (const [key, value] of Object.entries(updates)) {
      fm[key] = coerceValue(value);
    }

    const output = stringifyFrontmatter(parsed.content, fm);

    if (!dryRun) {
      writeFileSync(ctx.file, output, 'utf-8');
    }

    Object.assign(ctx.frontmatter, fm);

    const updatedFields = Object.keys(updates).join(', ');
    return {
      type: 'update-frontmatter',
      success: true,
      stdout: `Updated frontmatter: ${updatedFields}${dryRun ? ' [dry run]' : ''}`,
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      type: 'update-frontmatter',
      success: false,
      stdout: '',
      stderr: err.message || String(err),
      exitCode: 1,
      durationMs: Date.now() - start,
    };
  }
}

function coerceValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value) && value.length < 16) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value) && value.length < 16) return parseFloat(value);
  return value;
}
