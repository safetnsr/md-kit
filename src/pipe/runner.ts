import { execSync } from 'node:child_process';
import { dirname, basename } from 'node:path';
import type { MatchResult } from './matcher.js';

export interface RunResult {
  triggerName: string;
  filePath: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function interpolateCommand(template: string, match: MatchResult): string {
  const { file, diff } = match;
  const dir = dirname(file.filePath);
  const tags = file.tags.join(',');
  const fmJson = JSON.stringify(file.frontmatter);
  const diffJson = diff ? JSON.stringify(diff) : '{}';

  return template
    .replace(/\$FILE/g, file.filePath)
    .replace(/\$DIR/g, dir)
    .replace(/\$BASENAME/g, basename(file.filePath))
    .replace(/\$RELATIVE/g, file.relativePath)
    .replace(/\$FRONTMATTER/g, fmJson)
    .replace(/\$DIFF/g, diffJson)
    .replace(/\$TAGS/g, tags);
}

function buildFmEnvVars(frontmatter: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(frontmatter)) {
    if (val === null || val === undefined) continue;
    env[`FM_${key}`] = typeof val === 'object' ? JSON.stringify(val) : String(val);
  }
  return env;
}

export function executeAction(match: MatchResult, dryRun: boolean = false, configDir?: string): RunResult {
  const command = interpolateCommand(match.trigger.run, match);
  const triggerName = match.trigger.name;
  const filePath = match.file.filePath;

  if (dryRun) {
    return { triggerName, filePath, command, exitCode: 0, stdout: '[dry run]', stderr: '', durationMs: 0 };
  }

  let cwd: string;
  if (match.trigger.cwd === 'project' && configDir) {
    cwd = configDir;
  } else {
    cwd = dirname(match.file.filePath);
  }

  const fmEnv = buildFmEnvVars(match.file.frontmatter);
  const start = Date.now();

  try {
    const stdout = execSync(command, {
      cwd,
      timeout: 30000,
      encoding: 'utf-8',
      env: {
        ...process.env,
        FILE: match.file.filePath,
        DIR: dirname(match.file.filePath),
        BASENAME: basename(match.file.filePath),
        RELATIVE: match.file.relativePath,
        FRONTMATTER: JSON.stringify(match.file.frontmatter),
        DIFF: match.diff ? JSON.stringify(match.diff) : '{}',
        TAGS: match.file.tags.join(','),
        ...fmEnv,
      },
    });
    return { triggerName, filePath, command, exitCode: 0, stdout: stdout.trim(), stderr: '', durationMs: Date.now() - start };
  } catch (err: any) {
    return {
      triggerName, filePath, command,
      exitCode: err.status ?? 1,
      stdout: err.stdout?.trim() ?? '',
      stderr: err.stderr?.trim() ?? '',
      durationMs: Date.now() - start,
    };
  }
}
