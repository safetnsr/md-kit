import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { MdPipeConfig, TriggerMatch } from './config.js';
import { parseMarkdownFile, evaluateTrigger } from './matcher.js';

export interface TestResult {
  filePath: string;
  relativePath: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  matches: Array<{
    triggerName: string;
    type: 'trigger' | 'pipeline';
    reason: string;
  }>;
}

export function testFile(config: MdPipeConfig, filePath: string): TestResult {
  const absPath = resolve(filePath);

  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const relativePath = relative(config.watch, absPath);
  const file = parseMarkdownFile(absPath, relativePath);
  const matches: TestResult['matches'] = [];

  for (const trigger of config.triggers) {
    if (trigger.match.frontmatter_changed) {
      const staticMatch = { ...trigger.match };
      delete staticMatch.frontmatter_changed;
      const hasStatic = staticMatch.path || staticMatch.frontmatter || staticMatch.tags || staticMatch.content || staticMatch.content_regex;
      if (hasStatic) {
        const staticTrigger = { ...trigger, match: staticMatch };
        const staticResult = evaluateTrigger(staticTrigger, file);
        if (!staticResult) continue;
      }
      matches.push({
        triggerName: trigger.name,
        type: 'trigger',
        reason: `frontmatter_changed: would fire on changes to [${trigger.match.frontmatter_changed.join(', ')}]`,
      });
      continue;
    }

    const result = evaluateTrigger(trigger, file);
    if (result) {
      matches.push({
        triggerName: trigger.name,
        type: 'trigger',
        reason: buildMatchReason(trigger.match),
      });
    }
  }

  for (const pipeline of config.pipelines) {
    const triggerDef = { name: pipeline.name, match: pipeline.trigger, run: '' };

    if (pipeline.trigger.frontmatter_changed) {
      const staticMatch = { ...pipeline.trigger };
      delete staticMatch.frontmatter_changed;
      const hasStatic = staticMatch.path || staticMatch.frontmatter || staticMatch.tags || staticMatch.content || staticMatch.content_regex;
      if (hasStatic) {
        const staticTrigger = { ...triggerDef, match: staticMatch };
        const staticResult = evaluateTrigger(staticTrigger, file);
        if (!staticResult) continue;
      }
      matches.push({
        triggerName: pipeline.name,
        type: 'pipeline',
        reason: `frontmatter_changed: would fire on changes to [${pipeline.trigger.frontmatter_changed.join(', ')}] (${pipeline.steps.length} steps)`,
      });
      continue;
    }

    const result = evaluateTrigger(triggerDef, file);
    if (result) {
      matches.push({
        triggerName: pipeline.name,
        type: 'pipeline',
        reason: `${buildMatchReason(pipeline.trigger)} (${pipeline.steps.length} steps)`,
      });
    }
  }

  return { filePath: absPath, relativePath, frontmatter: file.frontmatter, tags: file.tags, matches };
}

function buildMatchReason(match: TriggerMatch): string {
  const reasons: string[] = [];
  if (match.path) reasons.push(`path matches "${match.path}"`);
  if (match.frontmatter) reasons.push(`frontmatter matches ${JSON.stringify(match.frontmatter)}`);
  if (match.tags) reasons.push(`has tags [${match.tags.join(', ')}]`);
  if (match.content) reasons.push(`body contains "${match.content}"`);
  if (match.content_regex) reasons.push(`body matches /${match.content_regex}/`);
  return reasons.join(' + ') || 'all conditions matched';
}
