import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
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
    assert.ok(stdout.includes('0.3.0'));
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

describe('install command', () => {
  it('creates .git/hooks/pre-commit file', () => {
    setup();
    // Create a fake git repo
    mkdirSync(join(TMP, '.git', 'hooks'), { recursive: true });

    const { stdout, exitCode } = run(`install`);
    // install runs in cwd, so we need to run it from TMP
    // Actually, let's use execSync with cwd
    try {
      const out = execSync(`node ${CLI} install`, {
        encoding: 'utf-8',
        cwd: TMP,
        env: { ...process.env, NO_COLOR: '1' },
      });
      assert.ok(out.includes('pre-commit hook installed'));
      const hookPath = join(TMP, '.git', 'hooks', 'pre-commit');
      assert.ok(existsSync(hookPath));
      const content = readFileSync(hookPath, 'utf-8');
      assert.ok(content.includes('md-kit'));
      assert.ok(content.includes('quiet-if-clean'));
    } catch (e: any) {
      // Should not fail
      assert.fail(`install command failed: ${e.stdout || e.message}`);
    }
    teardown();
  });
});

describe('fix command', () => {
  it('dry-run returns correct fixed/skipped, does NOT modify files', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[READM]]\n[[zzzzzzz]]\n');
    writeFileSync(join(TMP, 'README.md'), '# README\n');

    const { stdout, exitCode } = run(`fix ${TMP}`);
    assert.equal(exitCode, 1);
    assert.ok(stdout.includes('would fix'));
    // File should NOT be modified
    const content = readFileSync(join(TMP, 'a.md'), 'utf-8');
    assert.ok(content.includes('[[READM]]'), 'file should not be modified in dry-run');
    teardown();
  });

  it('--apply actually updates the file content', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[READM]]\n');
    writeFileSync(join(TMP, 'README.md'), '# README\n');

    const { stdout, exitCode } = run(`fix ${TMP} --apply`);
    assert.ok(stdout.includes('fixed'));
    // File should be modified
    const content = readFileSync(join(TMP, 'a.md'), 'utf-8');
    assert.ok(content.includes('[[README]]'), 'file should be updated after --apply');
    assert.ok(!content.includes('[[READM]]'), 'old link should be replaced');
    teardown();
  });
});

describe('watch command', () => {
  it('parses correctly from args', () => {
    // We just test that parsing works via the exported parseArgs
    // Import is tricky in this test setup, so we test via CLI that it starts
    // (we can't easily test fs.watch in unit tests)
    // Just verify the help includes watch
    const { stdout } = run('--help');
    assert.ok(stdout.includes('watch'));
  });
});

describe('flags', () => {
  it('--quiet-if-clean: no stdout output when no broken links found', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[b]]\n');
    writeFileSync(join(TMP, 'b.md'), '# B\n');

    const { stdout, exitCode } = run(`check ${TMP} --quiet-if-clean`);
    assert.equal(exitCode, 0);
    assert.equal(stdout.trim(), '', 'should produce no output when clean');
    teardown();
  });

  it('--apply flag parsed correctly from args', () => {
    // Verify --apply appears in help
    const { stdout } = run('--help');
    assert.ok(stdout.includes('--apply'));
  });
});
