import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseYaml } from './yaml-parser.js';
import type { PipelineDef, PipelineStepDef } from './pipeline.js';

export interface TriggerMatch {
  path?: string;
  frontmatter?: Record<string, unknown>;
  frontmatter_changed?: string[];
  tags?: string[];
  content?: string;
  content_regex?: string;
}

export interface TriggerDef {
  name: string;
  match: TriggerMatch;
  run: string;
  cwd?: 'project' | 'file';
}

export interface MdPipeConfig {
  watch: string;
  configDir: string;
  triggers: TriggerDef[];
  pipelines: PipelineDef[];
  debounce?: number;
}

const CONFIG_FILENAMES = ['.md-pipe.yml', '.md-pipe.yaml', 'md-pipe.yml', 'md-pipe.yaml'];

export function findConfigFile(dir: string): string | null {
  for (const name of CONFIG_FILENAMES) {
    const p = resolve(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function parseTriggerMatch(raw: Record<string, unknown>, name: string): TriggerMatch {
  const match: TriggerMatch = {};
  if (raw['path']) match.path = String(raw['path']);
  if (raw['frontmatter']) match.frontmatter = raw['frontmatter'] as Record<string, unknown>;
  if (raw['frontmatter_changed']) {
    if (!Array.isArray(raw['frontmatter_changed'])) {
      throw new Error(`Config error: trigger '${name}' frontmatter_changed must be an array`);
    }
    match.frontmatter_changed = (raw['frontmatter_changed'] as unknown[]).map(String);
  }
  if (raw['tags']) {
    if (!Array.isArray(raw['tags'])) {
      throw new Error(`Config error: trigger '${name}' tags must be an array`);
    }
    match.tags = (raw['tags'] as unknown[]).map(String);
  }
  if (raw['content'] !== undefined) match.content = String(raw['content']);
  if (raw['content_regex'] !== undefined) match.content_regex = String(raw['content_regex']);
  return match;
}

function parsePipelineStep(raw: Record<string, unknown>, pipelineName: string, index: number): PipelineStepDef {
  const step: PipelineStepDef = {};

  if (raw['run'] !== undefined) step.run = String(raw['run']);
  if (raw['update-frontmatter'] !== undefined) step['update-frontmatter'] = raw['update-frontmatter'] as Record<string, unknown>;
  if (raw['webhook'] !== undefined) step.webhook = raw['webhook'] as PipelineStepDef['webhook'];
  if (raw['copy'] !== undefined) {
    if (typeof raw['copy'] === 'string') {
      step.copy = { to: raw['copy'] };
    } else {
      step.copy = raw['copy'] as PipelineStepDef['copy'];
    }
  }
  if (raw['template'] !== undefined) step.template = raw['template'] as PipelineStepDef['template'];
  if (raw['continue_on_error'] !== undefined) step.continue_on_error = Boolean(raw['continue_on_error']);

  const hasType = step.run !== undefined ||
    step['update-frontmatter'] !== undefined ||
    step.webhook !== undefined ||
    step.copy !== undefined ||
    step.template !== undefined;

  if (!hasType) {
    throw new Error(`Config error: pipeline '${pipelineName}' step[${index}] has no recognized step type (run, update-frontmatter, webhook, copy, template)`);
  }

  return step;
}

export function loadConfig(configPath: string): MdPipeConfig {
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid config: expected YAML object in ${configPath}`);
  }

  if (!parsed['watch'] || typeof parsed['watch'] !== 'string') {
    throw new Error(`Config error: 'watch' must be a string path (e.g. "./docs")`);
  }

  const hasTriggers = Array.isArray(parsed['triggers']) && (parsed['triggers'] as unknown[]).length > 0;
  const hasPipelines = Array.isArray(parsed['pipelines']) && (parsed['pipelines'] as unknown[]).length > 0;

  if (!hasTriggers && !hasPipelines) {
    throw new Error(`Config error: must have at least one 'triggers' entry or 'pipelines' entry`);
  }

  const configDir = dirname(configPath);
  const triggers: TriggerDef[] = [];
  const pipelines: PipelineDef[] = [];

  if (hasTriggers) {
    const rawTriggers = parsed['triggers'] as Record<string, unknown>[];
    for (let i = 0; i < rawTriggers.length; i++) {
      const t = rawTriggers[i];
      if (!t['name'] || typeof t['name'] !== 'string') {
        throw new Error(`Config error: trigger[${i}] must have a 'name' string`);
      }
      if (!t['match'] || typeof t['match'] !== 'object') {
        throw new Error(`Config error: trigger '${t['name']}' must have a 'match' object`);
      }
      if (!t['run'] || typeof t['run'] !== 'string') {
        throw new Error(`Config error: trigger '${t['name']}' must have a 'run' string`);
      }

      const match = parseTriggerMatch(t['match'] as Record<string, unknown>, t['name'] as string);
      const cwd = t['cwd'] === 'project' ? 'project' : (t['cwd'] === 'file' ? 'file' : undefined);
      triggers.push({ name: t['name'] as string, match, run: t['run'] as string, ...(cwd ? { cwd } : {}) });
    }
  }

  if (hasPipelines) {
    const rawPipelines = parsed['pipelines'] as Record<string, unknown>[];
    for (let i = 0; i < rawPipelines.length; i++) {
      const p = rawPipelines[i];
      if (!p['name'] || typeof p['name'] !== 'string') {
        throw new Error(`Config error: pipeline[${i}] must have a 'name' string`);
      }
      if (!p['trigger'] || typeof p['trigger'] !== 'object') {
        throw new Error(`Config error: pipeline '${p['name']}' must have a 'trigger' object`);
      }
      if (!Array.isArray(p['steps']) || (p['steps'] as unknown[]).length === 0) {
        throw new Error(`Config error: pipeline '${p['name']}' must have a non-empty 'steps' array`);
      }

      const trigger = parseTriggerMatch(p['trigger'] as Record<string, unknown>, p['name'] as string);
      const rawSteps = p['steps'] as Record<string, unknown>[];
      const steps: PipelineStepDef[] = rawSteps.map((s, j) =>
        parsePipelineStep(s, p['name'] as string, j)
      );

      pipelines.push({
        name: p['name'] as string,
        trigger,
        steps,
        ...(p['continue_on_error'] ? { continue_on_error: true } : {}),
      });
    }
  }

  const watchPath = resolve(configDir, parsed['watch'] as string);

  let debounce: number | undefined;
  if (parsed['debounce'] !== undefined) {
    const d = parsed['debounce'];
    if (typeof d === 'string') {
      const ms = d.match(/^(\d+)\s*ms$/i);
      const s = d.match(/^(\d+)\s*s$/i);
      if (ms) debounce = parseInt(ms[1], 10);
      else if (s) debounce = parseInt(s[1], 10) * 1000;
      else debounce = parseInt(d, 10) || undefined;
    } else if (typeof d === 'number') {
      debounce = d;
    }
  }

  return { watch: watchPath, configDir, triggers, pipelines, ...(debounce ? { debounce } : {}) };
}

export function generateDefaultConfig(): string {
  return `# md-pipe configuration
# docs: https://github.com/safetnsr/md-kit

watch: ./docs

# Legacy triggers (simple: match + run command)
triggers:
  - name: publish
    match:
      path: "posts/**"
      frontmatter:
        status: publish
    run: "echo Publishing $FILE"

# Pipelines (v0.3+): multi-step content pipelines
# pipelines:
#   - name: publish-post
#     trigger:
#       path: "posts/**"
#       frontmatter: { status: publish }
#       frontmatter_changed: [status]
#     steps:
#       - run: "echo Publishing {{fm.title}}"
#       - update-frontmatter: { published_at: "{{now}}", published: true }
#       - copy: { to: "./_site/posts" }
#       - webhook: { url: "$WEBHOOK_URL" }
`;
}
