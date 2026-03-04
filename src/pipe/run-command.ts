import { readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { MdPipeConfig } from './config.js';
import { parseMarkdownFile, evaluateTrigger } from './matcher.js';
import { executePipeline, triggerToPipeline, type PipelineDef, type PipelineResult } from './pipeline.js';

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

export interface RunCommandResult {
  success: boolean;
  results: PipelineResult[];
  errors: string[];
}

export async function runPipelineCommand(
  config: MdPipeConfig,
  pipelineName: string,
  filePath?: string,
  dryRun: boolean = false
): Promise<RunCommandResult> {
  let pipeline: PipelineDef | undefined;

  pipeline = config.pipelines.find(p => p.name === pipelineName);

  if (!pipeline) {
    const trigger = config.triggers.find(t => t.name === pipelineName);
    if (trigger) pipeline = triggerToPipeline(trigger);
  }

  if (!pipeline) {
    const available = [
      ...config.pipelines.map(p => p.name),
      ...config.triggers.map(t => t.name),
    ];
    return {
      success: false,
      results: [],
      errors: [`Pipeline '${pipelineName}' not found. Available: ${available.join(', ') || 'none'}`],
    };
  }

  const results: PipelineResult[] = [];
  const errors: string[] = [];

  if (filePath) {
    const absPath = resolve(filePath);
    const relPath = relative(config.watch, absPath);
    try {
      const file = parseMarkdownFile(absPath, relPath);
      const match = { trigger: { name: pipeline.name, match: pipeline.trigger, run: '' }, file, diff: null };
      const result = await executePipeline(pipeline, match, config.configDir, dryRun);
      results.push(result);
    } catch (err: any) {
      errors.push(`Error processing ${filePath}: ${err.message}`);
    }
  } else {
    const files = findMarkdownFiles(config.watch);
    for (const fp of files) {
      const relPath = relative(config.watch, fp);
      try {
        const file = parseMarkdownFile(fp, relPath);
        const triggerDef = { name: pipeline.name, match: pipeline.trigger, run: '' };
        const match = evaluateTrigger(triggerDef, file);
        if (match) {
          const result = await executePipeline(pipeline, match, config.configDir, dryRun);
          results.push(result);
        }
      } catch (err: any) {
        errors.push(`Error processing ${fp}: ${err.message}`);
      }
    }
  }

  const success = errors.length === 0 && results.every(r => r.success);
  return { success, results, errors };
}
