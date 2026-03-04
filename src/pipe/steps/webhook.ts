import { expandTemplate, expandDeep, type TemplateContext } from '../template-vars.js';
import type { StepResult } from './run.js';

export interface WebhookStepConfig {
  webhook: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
}

export async function executeWebhookStep(
  config: WebhookStepConfig,
  ctx: TemplateContext,
  dryRun: boolean
): Promise<StepResult> {
  const start = Date.now();
  const wh = config.webhook;

  let url = expandTemplate(wh.url, ctx);
  url = expandEnvVars(url);

  const method = (wh.method || 'POST').toUpperCase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(wh.headers ? expandDeep(wh.headers, ctx) as Record<string, string> : {}),
  };

  let body: string | undefined;
  if (wh.body) {
    const expanded = expandDeep(wh.body, ctx);
    body = JSON.stringify(expanded, (_key, val) => {
      if (typeof val === 'string') return expandEnvVars(val);
      return val;
    });
  } else {
    body = JSON.stringify({
      file: ctx.file,
      relative: ctx.relative,
      slug: ctx.slug,
      frontmatter: ctx.frontmatter,
    });
  }

  if (dryRun) {
    return { type: 'webhook', success: true, stdout: `[dry run] ${method} ${url}`, stderr: '', exitCode: 0, durationMs: Date.now() - start };
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? body : undefined,
    });

    const responseText = await response.text();
    const success = response.ok;

    return {
      type: 'webhook',
      success,
      stdout: responseText.slice(0, 4096),
      stderr: success ? '' : `HTTP ${response.status} ${response.statusText}`,
      exitCode: success ? 0 : 1,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return { type: 'webhook', success: false, stdout: '', stderr: err.message || String(err), exitCode: 1, durationMs: Date.now() - start };
  }
}

function expandEnvVars(str: string): string {
  return str.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_match, name) => process.env[name] || '');
}
