import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'build', 'src', 'cli.js');
const TMP = join(process.cwd(), '.test-tmp-v050');

function run(args: string, cwd?: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      encoding: 'utf-8',
      cwd: cwd || process.cwd(),
      env: { ...process.env, NO_COLOR: '1' },
    });
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

describe('v0.5.0 — severity', () => {
  it('getSeverity returns info for untracked file', () => {
    // Import and test directly
    const { getSeverity } = require('../src/core/severity.js');
    // Non-git directory => Infinity days => info
    const sev = getSeverity('nonexistent.md', '/tmp');
    assert.equal(sev, 'info');
  });

  it('getSeverity returns critical for recently committed file', () => {
    setup();
    // Create a git repo with a recently committed file
    execSync('git init && git config user.email "test@test.com" && git config user.name "test"', { cwd: TMP, stdio: 'pipe' });
    writeFileSync(join(TMP, 'recent.md'), '# Recent\n');
    execSync('git add -A && git commit -m "init"', { cwd: TMP, stdio: 'pipe' });

    const { getSeverity } = require('../src/core/severity.js');
    const sev = getSeverity('recent.md', TMP);
    assert.equal(sev, 'critical');
    teardown();
  });

  it('JSON output includes critical, warnings, info, ignored_count', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[missing1]]\n[[missing2]]\n');

    const { stdout, exitCode } = run(`check ${TMP} --json`);
    const data = JSON.parse(stdout);
    assert.equal(exitCode, 1);
    assert.ok('critical' in data, 'should have critical field');
    assert.ok('warnings' in data, 'should have warnings field');
    assert.ok('info' in data, 'should have info field');
    assert.ok('ignored_count' in data, 'should have ignored_count field');
    assert.ok('broken_count' in data, 'should have broken_count field');
    assert.equal(data.broken_count, 2);
    // Results should have severity
    assert.ok(data.results[0].severity, 'results should have severity');
    teardown();
  });
});

describe('v0.5.0 — .mdkitignore', () => {
  it('loadIgnorePatterns returns empty array when no .mdkitignore', () => {
    const { loadIgnorePatterns } = require('../src/core/ignore.js');
    const patterns = loadIgnorePatterns('/tmp/nonexistent-dir-xyz');
    assert.deepEqual(patterns, []);
  });

  it('isIgnored matches exact strings and wildcard patterns', () => {
    const { isIgnored } = require('../src/core/ignore.js');
    assert.equal(isIgnored('missing', ['missing']), true);
    assert.equal(isIgnored('missing', ['other']), false);
    assert.equal(isIgnored('draft-intro', ['draft-*']), true);
    assert.equal(isIgnored('final-intro', ['draft-*']), false);
  });

  it('findBrokenLinks excludes ignored links', () => {
    setup();
    writeFileSync(join(TMP, '.mdkitignore'), 'ignored-link\n');
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[ignored-link]]\n[[broken-link]]\n');

    const { stdout } = run(`check ${TMP} --json`);
    const data = JSON.parse(stdout);
    // Only broken-link should appear, not ignored-link
    assert.equal(data.broken_count, 1);
    assert.equal(data.results[0].link, 'broken-link');
    assert.equal(data.ignored_count, 1);
    teardown();
  });

  it('md-kit ignore <link> writes to .mdkitignore', () => {
    setup();
    const { exitCode, stdout } = run(`ignore some-link`, TMP);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('added [[some-link]] to .mdkitignore'));
    const content = readFileSync(join(TMP, '.mdkitignore'), 'utf-8');
    assert.ok(content.includes('some-link'));
    teardown();
  });
});

describe('v0.5.0 — summary-first output', () => {
  it('default output shows only critical items (not warnings/info)', () => {
    setup();
    // All broken links in non-git dir => all info severity
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[missing]]\n');

    const { stdout } = run(`check ${TMP}`);
    // Should mention "broken links" in summary
    assert.ok(stdout.includes('broken link'), 'should have summary header');
    // Since all are info, and default shows only critical, the table should be empty
    // but summary should still show the count
    assert.ok(stdout.includes('info'), 'should mention info count');
    teardown();
  });

  it('--full flag shows all severity levels', () => {
    setup();
    writeFileSync(join(TMP, 'a.md'), '# Hello\n[[missing1]]\n[[missing2]]\n');

    const { stdout } = run(`check ${TMP} --full`);
    // Should show all broken links in the table
    assert.ok(stdout.includes('missing1'), 'should show missing1 with --full');
    assert.ok(stdout.includes('missing2'), 'should show missing2 with --full');
    teardown();
  });
});

describe('v0.5.0 — --since flag', () => {
  it('--since yesterday filters to only recently-modified files', () => {
    setup();
    // Create a git repo
    execSync('git init && git config user.email "test@test.com" && git config user.name "test"', { cwd: TMP, stdio: 'pipe' });
    writeFileSync(join(TMP, 'recent.md'), '# Recent\n[[broken-recent]]\n');
    writeFileSync(join(TMP, 'old.md'), '# Old\n');
    execSync('git add -A && git commit -m "init"', { cwd: TMP, stdio: 'pipe' });

    // Check with --since yesterday — recent.md was committed just now, so it should be included
    const { stdout } = run(`check ${TMP} --json --since yesterday`);
    const data = JSON.parse(stdout);
    assert.equal(data.broken_count, 1);
    assert.equal(data.results[0].link, 'broken-recent');
    teardown();
  });
});

describe('v0.5.0 — version', () => {
  it('--version shows 0.5.0', () => {
    const { stdout } = run('--version');
    assert.ok(stdout.includes('0.5.0'));
  });
});
