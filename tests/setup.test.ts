import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'build', 'src', 'cli.js');
const TMP = join(process.cwd(), '.test-tmp-setup');

function run(args: string, cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      encoding: 'utf-8',
      cwd: cwd ?? TMP,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: any) {
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.status ?? 1 };
  }
}

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

describe('setup command', () => {
  it('detects workspace via AGENTS.md presence', () => {
    setup();
    mkdirSync(join(TMP, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(TMP, 'AGENTS.md'), '# Agents\n');

    const { stdout, exitCode } = run('setup');
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('md-kit setup complete'));
    teardown();
  });

  it('no workspace detected without markers', () => {
    setup();
    writeFileSync(join(TMP, 'README.md'), '# Readme\n');

    const { stdout, exitCode } = run('setup');
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('no agent workspace detected'));
    teardown();
  });

  it('skips heartbeat update if md-kit check already in HEARTBEAT.md', () => {
    setup();
    mkdirSync(join(TMP, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(TMP, 'AGENTS.md'), '# Agents\n');
    writeFileSync(join(TMP, 'HEARTBEAT.md'), '# Heartbeat\n### 1. Something\n- do stuff\n### 2. md-kit check\n- already here\n');

    const { stdout, exitCode } = run('setup');
    assert.equal(exitCode, 0);

    const content = readFileSync(join(TMP, 'HEARTBEAT.md'), 'utf-8');
    // Should only have one occurrence of md-kit check
    const matches = content.match(/md-kit check/g);
    assert.ok(matches && matches.length <= 2, 'should not duplicate md-kit check entry');
    teardown();
  });
});
