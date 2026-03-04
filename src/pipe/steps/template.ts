import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { expandTemplate, type TemplateContext } from '../template-vars.js';
import type { StepResult } from './run.js';

export interface TemplateStepConfig {
  template: {
    src: string;
    out: string;
  };
}

export function executeTemplateStep(
  config: TemplateStepConfig,
  ctx: TemplateContext,
  configDir: string,
  dryRun: boolean
): StepResult {
  const start = Date.now();

  try {
    const srcPath = resolve(configDir, expandTemplate(config.template.src, ctx));
    const outPath = resolve(configDir, expandTemplate(config.template.out, ctx));

    const templateContent = readFileSync(srcPath, 'utf-8');
    const rendered = expandTemplate(templateContent, ctx);

    if (!dryRun) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, rendered, 'utf-8');
    }

    return {
      type: 'template',
      success: true,
      stdout: `Rendered ${srcPath} → ${outPath}${dryRun ? ' [dry run]' : ''}`,
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return { type: 'template', success: false, stdout: '', stderr: err.message || String(err), exitCode: 1, durationMs: Date.now() - start };
  }
}
