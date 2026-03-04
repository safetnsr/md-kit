import { execSync } from 'node:child_process';
import { expandTemplate, buildEnvVars, type TemplateContext } from '../template-vars.js';

export interface RunStepConfig {
  run: string;
}

export interface StepResult {
  type: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export function executeRunStep(
  config: RunStepConfig,
  ctx: TemplateContext,
  cwd: string,
  dryRun: boolean
): StepResult {
  const command = expandTemplate(config.run, ctx);

  if (dryRun) {
    return { type: 'run', success: true, stdout: '[dry run]', stderr: '', exitCode: 0, durationMs: 0 };
  }

  const env = buildEnvVars(ctx);
  const start = Date.now();

  try {
    const stdout = execSync(command, {
      cwd,
      timeout: 30000,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    });
    return { type: 'run', success: true, stdout: stdout.trim(), stderr: '', exitCode: 0, durationMs: Date.now() - start };
  } catch (err: any) {
    return {
      type: 'run',
      success: false,
      stdout: err.stdout?.trim() ?? '',
      stderr: err.stderr?.trim() ?? '',
      exitCode: err.status ?? 1,
      durationMs: Date.now() - start,
    };
  }
}
