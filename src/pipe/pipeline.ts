import { dirname } from 'node:path';
import type { TriggerMatch } from './config.js';
import type { MatchResult, FileState } from './matcher.js';
import { buildContext, type TemplateContext, type StepOutput } from './template-vars.js';
import { executeRunStep, type StepResult } from './steps/run.js';
import { executeUpdateFrontmatterStep } from './steps/update-frontmatter.js';
import { executeWebhookStep } from './steps/webhook.js';
import { executeCopyStep } from './steps/copy.js';
import { executeTemplateStep } from './steps/template.js';

export interface PipelineStepDef {
  run?: string;
  'update-frontmatter'?: Record<string, unknown>;
  webhook?: { url: string; method?: string; headers?: Record<string, string>; body?: unknown };
  copy?: { to: string; flatten?: boolean };
  template?: { src: string; out: string };
  continue_on_error?: boolean;
}

export interface PipelineDef {
  name: string;
  trigger: TriggerMatch;
  steps: PipelineStepDef[];
  continue_on_error?: boolean;
}

export interface PipelineResult {
  pipelineName: string;
  filePath: string;
  steps: StepResult[];
  success: boolean;
  durationMs: number;
}

function getStepType(step: PipelineStepDef): string | null {
  if (step.run !== undefined) return 'run';
  if (step['update-frontmatter'] !== undefined) return 'update-frontmatter';
  if (step.webhook !== undefined) return 'webhook';
  if (step.copy !== undefined) return 'copy';
  if (step.template !== undefined) return 'template';
  return null;
}

async function executeStep(
  step: PipelineStepDef,
  ctx: TemplateContext,
  configDir: string,
  dryRun: boolean
): Promise<StepResult> {
  const type = getStepType(step);

  switch (type) {
    case 'run':
      return executeRunStep({ run: step.run! }, ctx, dirname(ctx.file), dryRun);
    case 'update-frontmatter':
      return executeUpdateFrontmatterStep({ 'update-frontmatter': step['update-frontmatter']! }, ctx, dryRun);
    case 'webhook':
      return await executeWebhookStep({ webhook: step.webhook! }, ctx, dryRun);
    case 'copy':
      return executeCopyStep({ copy: step.copy! }, ctx, configDir, dryRun);
    case 'template':
      return executeTemplateStep({ template: step.template! }, ctx, configDir, dryRun);
    default:
      return {
        type: 'unknown',
        success: false,
        stdout: '',
        stderr: `Unknown step type in: ${JSON.stringify(step)}`,
        exitCode: 1,
        durationMs: 0,
      };
  }
}

export async function executePipeline(
  pipeline: PipelineDef,
  match: MatchResult,
  configDir: string,
  dryRun: boolean = false
): Promise<PipelineResult> {
  const { file, diff } = match;
  const ctx = buildContext(
    file.filePath,
    file.relativePath,
    dirname(file.filePath),
    { ...file.frontmatter },
    [...file.tags],
    file.content,
    file.body,
    diff
  );

  const stepResults: StepResult[] = [];
  const pipelineStart = Date.now();
  let allSuccess = true;

  for (const step of pipeline.steps) {
    const result = await executeStep(step, ctx, configDir, dryRun);
    stepResults.push(result);

    const stepOutput: StepOutput = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
    ctx.steps.push(stepOutput);

    if (!result.success) {
      allSuccess = false;
      const continueOnError = step.continue_on_error ?? pipeline.continue_on_error ?? false;
      if (!continueOnError) break;
    }
  }

  return {
    pipelineName: pipeline.name,
    filePath: file.filePath,
    steps: stepResults,
    success: allSuccess,
    durationMs: Date.now() - pipelineStart,
  };
}

export function triggerToPipeline(trigger: { name: string; match: TriggerMatch; run: string }): PipelineDef {
  return {
    name: trigger.name,
    trigger: trigger.match,
    steps: [{ run: trigger.run }],
  };
}
