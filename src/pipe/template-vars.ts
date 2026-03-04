import { basename, extname } from 'node:path';

export interface TemplateContext {
  file: string;
  dir: string;
  basename: string;
  relative: string;
  slug: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  content: string;
  body: string;
  diff: Record<string, { old: unknown; new: unknown }> | null;
  steps: StepOutput[];
}

export interface StepOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  [key: string]: unknown;
}

export function expandTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const k = key.trim();

    switch (k) {
      case 'now': return new Date().toISOString();
      case 'date': return new Date().toISOString().split('T')[0];
      case 'timestamp': return String(Date.now());
      case 'slug': return ctx.slug;
      case 'file': return ctx.file;
      case 'basename': return ctx.basename;
      case 'relative': return ctx.relative;
      case 'dir': return ctx.dir;
      case 'tags': return ctx.tags.join(',');
      case 'content': return ctx.body;
    }

    if (k.startsWith('fm.')) {
      const field = k.slice(3);
      const val = ctx.frontmatter[field];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    }

    if (k.startsWith('step.')) {
      const parts = k.slice(5).split('.');
      const idx = parseInt(parts[0], 10);
      const field = parts.slice(1).join('.');
      if (isNaN(idx) || idx < 0 || idx >= ctx.steps.length) return '';
      const step = ctx.steps[idx];
      if (!step) return '';
      const val = step[field];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    }

    return `{{${k}}}`;
  });
}

export function expandDeep(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') return expandTemplate(value, ctx);
  if (Array.isArray(value)) return value.map(v => expandDeep(v, ctx));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = expandDeep(v, ctx);
    }
    return result;
  }
  return value;
}

export function buildContext(
  filePath: string,
  relativePath: string,
  dir: string,
  frontmatter: Record<string, unknown>,
  tags: string[],
  content: string,
  body: string,
  diff: Record<string, { old: unknown; new: unknown }> | null
): TemplateContext {
  const ext = extname(relativePath);
  const slug = basename(relativePath, ext);

  return {
    file: filePath,
    dir,
    basename: basename(filePath),
    relative: relativePath,
    slug,
    frontmatter,
    tags,
    content,
    body,
    diff,
    steps: [],
  };
}

export function buildEnvVars(ctx: TemplateContext): Record<string, string> {
  const env: Record<string, string> = {
    FILE: ctx.file,
    DIR: ctx.dir,
    BASENAME: ctx.basename,
    RELATIVE: ctx.relative,
    SLUG: ctx.slug,
    FRONTMATTER: JSON.stringify(ctx.frontmatter),
    DIFF: ctx.diff ? JSON.stringify(ctx.diff) : '{}',
    TAGS: ctx.tags.join(','),
  };

  for (const [key, val] of Object.entries(ctx.frontmatter)) {
    if (val === null || val === undefined) continue;
    env[`FM_${key}`] = typeof val === 'object' ? JSON.stringify(val) : String(val);
  }

  for (let i = 0; i < ctx.steps.length; i++) {
    const step = ctx.steps[i];
    if (step.stdout) env[`STEP_${i}_STDOUT`] = step.stdout;
    if (step.stderr) env[`STEP_${i}_STDERR`] = step.stderr;
  }
  if (ctx.steps.length > 0) {
    env.STEP_OUTPUT = ctx.steps[ctx.steps.length - 1].stdout || '';
  }

  return env;
}
