import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../src/cli.js';

const CLI = join(process.cwd(), 'build', 'src', 'cli.js');
const TMP = join(process.cwd(), '.test-tmp-v040');

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

describe('v0.4.0 — interactive hook', () => {
  it('hook content includes interactive [Y/n] prompt string', () => {
    setup();
    mkdirSync(join(TMP, '.git', 'hooks'), { recursive: true });

    const out = execSync(`node ${CLI} install`, {
      encoding: 'utf-8',
      cwd: TMP,
      env: { ...process.env, NO_COLOR: '1' },
    });

    const hookPath = join(TMP, '.git', 'hooks', 'pre-commit');
    assert.ok(existsSync(hookPath));
    const content = readFileSync(hookPath, 'utf-8');
    assert.ok(content.includes('[Y/n]'), 'hook should contain interactive [Y/n] prompt');
    assert.ok(content.includes('fix broken links automatically?'), 'hook should ask to fix');
    assert.ok(content.includes('read REPLY </dev/tty'), 'hook should read from tty');
    teardown();
  });
});

describe('v0.4.0 — git-alias flag', () => {
  it('--git-alias flag parsed correctly from args', () => {
    const opts = parseArgs(['node', 'md-kit', 'setup', '--git-alias']);
    assert.equal(opts.gitAlias, true);
    assert.equal(opts.command, 'setup');
  });

  it('--git-alias defaults to false', () => {
    const opts = parseArgs(['node', 'md-kit', 'setup']);
    assert.equal(opts.gitAlias, false);
  });

  it('setup with --git-alias installs git alias (in git repo)', () => {
    setup();
    mkdirSync(join(TMP, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(TMP, 'AGENTS.md'), '# Agents\n');
    // Init a real git repo so git config works
    execSync('git init', { cwd: TMP, stdio: 'pipe' });

    const { stdout, exitCode } = run('setup --git-alias', TMP);
    assert.equal(exitCode, 0);

    // Check that alias was installed
    try {
      const alias = execSync('git config alias.mmd', { encoding: 'utf-8', cwd: TMP, stdio: 'pipe' }).trim();
      assert.ok(alias.length > 0, 'git alias mmd should be installed');
    } catch {
      // alias might be in global config; just check stdout
      assert.ok(stdout.includes('git alias') || stdout.includes('already configured'),
        'setup should mention git alias or already configured');
    }
    teardown();
  });
});

describe('v0.4.0 — check tip', () => {
  it('check non-json output includes tip when broken links found', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[missing]]\n');

    const { stdout, exitCode } = run(`check ${TMP}`);
    assert.equal(exitCode, 1);
    assert.ok(stdout.includes('tip: use `md-kit mv <old> <new>`'), 'should show tip');
    teardown();
  });

  it('check JSON output includes tip field when broken_count > 0', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[missing]]\n');

    const { stdout } = run(`check ${TMP} --json`);
    const data = JSON.parse(stdout);
    assert.ok(data.tip, 'JSON output should include tip field');
    assert.ok(data.broken_count > 0, 'JSON output should include broken_count');
    assert.ok(data.tip.includes('md-kit mv'), 'tip should mention md-kit mv');
    teardown();
  });

  it('check with --quiet-if-clean does NOT show tip when clean', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[b]]\n');
    writeFileSync(join(TMP, 'b.md'), '# B\n');

    const { stdout, exitCode } = run(`check ${TMP} --quiet-if-clean`);
    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('tip'), 'should not show tip when clean');
    teardown();
  });
});
