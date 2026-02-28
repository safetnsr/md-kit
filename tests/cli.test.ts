import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'build', 'src', 'cli.js');
const TMP = join(process.cwd(), '.test-tmp-cli');

function run(args: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
    return { stdout, exitCode: 0 };
  } catch (e: any) {
    return { stdout: e.stdout ?? '', exitCode: e.status ?? 1 };
  }
}

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

describe('CLI', () => {
  it('--help shows usage', () => {
    const { stdout, exitCode } = run('--help');
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('md-kit'));
    assert.ok(stdout.includes('check'));
  });

  it('--version shows version', () => {
    const { stdout, exitCode } = run('--version');
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('0.1.0'));
  });

  it('check with no broken links exits 0', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[b]]\n');
    writeFileSync(join(TMP, 'b.md'), '# B\n');

    const { exitCode, stdout } = run(`check ${TMP}`);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('all links valid'));
    teardown();
  });

  it('check with broken links exits 1', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[missing]]\n');

    const { exitCode, stdout } = run(`check ${TMP}`);
    assert.equal(exitCode, 1);
    assert.ok(stdout.includes('broken'));
    teardown();
  });

  it('--json outputs valid JSON', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[missing]]\n');

    const { stdout } = run(`check ${TMP} --json`);
    const data = JSON.parse(stdout);
    assert.equal(data.brokenLinks, 1);
    assert.equal(data.results[0].type, 'wikilink');
    assert.equal(data.results[0].link, 'missing');
    teardown();
  });

  it('--json with no broken links', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n');

    const { stdout, exitCode } = run(`check ${TMP} --json`);
    const data = JSON.parse(stdout);
    assert.equal(exitCode, 0);
    assert.equal(data.brokenLinks, 0);
    assert.equal(data.results.length, 0);
    teardown();
  });

  it('empty directory shows no files', () => {
    setup();
    const { stdout, exitCode } = run(`check ${TMP}`);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('No markdown files'));
    teardown();
  });

  it('unknown command exits 1', () => {
    const { exitCode } = run('foobar');
    assert.equal(exitCode, 1);
  });
});
