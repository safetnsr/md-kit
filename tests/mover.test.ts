import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'build', 'src', 'cli.js');
const TMP = join(process.cwd(), '.test-tmp-mover');

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

describe('mv command', () => {
  it('dry-run: returns correct JSON, does NOT move files or modify links', () => {
    setup();
    mkdirSync(join(TMP, 'memory'), { recursive: true });
    mkdirSync(join(TMP, 'memory', 'daily'), { recursive: true });
    writeFileSync(join(TMP, 'memory', 'lessons.md'), '# Lessons\n');
    writeFileSync(join(TMP, 'AGENTS.md'), '# Agents\nSee [[lessons]] for details\n');
    writeFileSync(join(TMP, 'NOW.md'), '# Now\n[lessons](memory/lessons.md)\n');

    const { stdout, exitCode } = run('mv memory/lessons.md memory/daily/lessons.md --dry-run --json');
    assert.equal(exitCode, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.moved, false);
    assert.equal(data.dry_run, true);
    assert.equal(data.old, 'memory/lessons.md');
    assert.equal(data.new, 'memory/daily/lessons.md');
    assert.ok(data.links_updated >= 1);

    // Files should NOT be moved
    assert.ok(existsSync(join(TMP, 'memory', 'lessons.md')), 'source should still exist');
    assert.ok(!existsSync(join(TMP, 'memory', 'daily', 'lessons.md')), 'dest should not exist');

    // Links should NOT be modified
    const agents = readFileSync(join(TMP, 'AGENTS.md'), 'utf-8');
    assert.ok(agents.includes('[[lessons]]'), 'wikilink should not be changed');
    teardown();
  });

  it('apply: moves file and updates links in other files', () => {
    setup();
    mkdirSync(join(TMP, 'memory'), { recursive: true });
    mkdirSync(join(TMP, 'memory', 'daily'), { recursive: true });
    writeFileSync(join(TMP, 'memory', 'lessons.md'), '# Lessons\n');
    // Use path-style wikilink so it actually needs updating
    writeFileSync(join(TMP, 'AGENTS.md'), '# Agents\nSee [[memory/lessons]] for details\n');
    writeFileSync(join(TMP, 'NOW.md'), '# Now\n[lessons](memory/lessons.md)\n');

    const { exitCode } = run('mv memory/lessons.md memory/daily/lessons.md');
    assert.equal(exitCode, 0);

    // File should be moved
    assert.ok(!existsSync(join(TMP, 'memory', 'lessons.md')), 'source should be gone');
    assert.ok(existsSync(join(TMP, 'memory', 'daily', 'lessons.md')), 'dest should exist');

    // Links should be updated
    const agents = readFileSync(join(TMP, 'AGENTS.md'), 'utf-8');
    assert.ok(agents.includes('[[memory/daily/lessons]]'), 'wikilink should be updated');

    const now = readFileSync(join(TMP, 'NOW.md'), 'utf-8');
    assert.ok(now.includes('memory/daily/lessons.md'), 'relative link should be updated');
    teardown();
  });

  it('error: source does not exist → exit 1', () => {
    setup();
    const { exitCode, stderr } = run('mv nonexistent.md somewhere.md');
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('source does not exist'));
    teardown();
  });
});
