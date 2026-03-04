import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { expandTemplate, type TemplateContext } from '../template-vars.js';
import type { StepResult } from './run.js';

export interface CopyStepConfig {
  copy: {
    to: string;
    flatten?: boolean;
  };
}

export function executeCopyStep(
  config: CopyStepConfig,
  ctx: TemplateContext,
  configDir: string,
  dryRun: boolean
): StepResult {
  const start = Date.now();

  try {
    const destDir = resolve(configDir, expandTemplate(config.copy.to, ctx));
    const flatten = config.copy.flatten ?? false;
    const destPath = flatten ? join(destDir, ctx.basename) : join(destDir, ctx.relative);

    if (!dryRun) {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(ctx.file, destPath);
    }

    return {
      type: 'copy',
      success: true,
      stdout: `Copied to ${destPath}${dryRun ? ' [dry run]' : ''}`,
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return { type: 'copy', success: false, stdout: '', stderr: err.message || String(err), exitCode: 1, durationMs: Date.now() - start };
  }
}
