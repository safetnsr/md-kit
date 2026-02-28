import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../src/cli.js';

const CLI = join(process.cwd(), 'build', 'src', 'cli.js');
const TMP = join(process.cwd(), '.test-tmp-patch');

function run(args: string, cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      encoding: 'utf-8',
      cwd: cwd ?? process.cwd(),
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

describe('fix --patch', () => {
  it('writes md-kit-fixes.md file', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[READM]]\n');
    writeFileSync(join(TMP, 'README.md'), '# README\n');

    const { stdout, exitCode } = run(`fix ${TMP} --patch`);
    assert.equal(exitCode, 1);
    assert.ok(stdout.includes('wrote md-kit-fixes.md'));

    const fixesPath = join(TMP, 'md-kit-fixes.md');
    assert.ok(existsSync(fixesPath), 'md-kit-fixes.md should be created');

    const content = readFileSync(fixesPath, 'utf-8');
    assert.ok(content.includes('# md-kit fixes'));
    assert.ok(content.includes('pending fixes'));
    assert.ok(content.includes('[[READM]]'));
    teardown();
  });
});

describe('--dry-run flag', () => {
  it('parsed correctly from args', () => {
    const opts = parseArgs(['node', 'md-kit', 'mv', 'old.md', 'new.md', '--dry-run']);
    assert.equal(opts.command, 'mv');
    assert.equal(opts.dryRun, true);
    assert.equal(opts.positionals[0], 'old.md');
    assert.equal(opts.positionals[1], 'new.md');
  });
});
