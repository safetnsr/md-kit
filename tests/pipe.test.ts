import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const CLI = join(process.cwd(), 'build', 'src', 'cli.js');
const TMP = join(process.cwd(), '.test-tmp-pipe');
const DOCS = join(TMP, 'docs');

function run(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
      cwd: TMP,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: any) {
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.status ?? 1 };
  }
}

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(DOCS, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

// ─── YAML parser tests ───────────────────────────────────────────────────────

describe('pipe — yaml-parser', () => {
  // Import inline via the build output
  let parseYaml: (text: string) => Record<string, unknown>;

  before(async () => {
    const mod = await import(join(process.cwd(), 'build', 'src', 'pipe', 'yaml-parser.js'));
    parseYaml = mod.parseYaml;
  });

  it('parses simple key-value scalars', () => {
    const result = parseYaml('watch: ./docs\ndebounce: 200\n');
    assert.equal(result['watch'], './docs');
    assert.equal(result['debounce'], 200);
  });

  it('parses boolean values', () => {
    const result = parseYaml('enabled: true\ndisabled: false\n');
    assert.equal(result['enabled'], true);
    assert.equal(result['disabled'], false);
  });

  it('parses null values', () => {
    const result = parseYaml('empty: null\nalso: ~\n');
    assert.equal(result['empty'], null);
    assert.equal(result['also'], null);
  });

  it('parses quoted strings', () => {
    const result = parseYaml('path: "posts/**"\n');
    assert.equal(result['path'], 'posts/**');
  });

  it('parses flow sequences', () => {
    const result = parseYaml('tags: [status, title]\n');
    assert.deepEqual(result['tags'], ['status', 'title']);
  });

  it('parses flow mappings', () => {
    const result = parseYaml('fm: { status: publish }\n');
    const fm = result['fm'] as Record<string, unknown>;
    assert.equal(fm['status'], 'publish');
  });

  it('ignores inline comments', () => {
    const result = parseYaml('watch: ./docs # the directory\n');
    assert.equal(result['watch'], './docs');
  });

  it('parses block sequences', () => {
    const yaml = `triggers:\n  - name: publish\n    match:\n      path: "posts/**"\n    run: "echo hi"\n`;
    const result = parseYaml(yaml);
    const triggers = result['triggers'] as Record<string, unknown>[];
    assert.ok(Array.isArray(triggers));
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0]['name'], 'publish');
  });
});

// ─── frontmatter parser tests ─────────────────────────────────────────────────

describe('pipe — frontmatter', () => {
  let parseFrontmatter: (input: string) => { data: Record<string, unknown>; content: string };
  let stringifyFrontmatter: (content: string, data: Record<string, unknown>) => string;

  before(async () => {
    const mod = await import(join(process.cwd(), 'build', 'src', 'pipe', 'frontmatter.js'));
    parseFrontmatter = mod.parseFrontmatter;
    stringifyFrontmatter = mod.stringifyFrontmatter;
  });

  it('parses frontmatter and body', () => {
    const md = '---\ntitle: Hello\nstatus: publish\n---\n\n# Hello\n\nbody text\n';
    const result = parseFrontmatter(md);
    assert.equal(result.data['title'], 'Hello');
    assert.equal(result.data['status'], 'publish');
    assert.ok(result.content.includes('# Hello'));
  });

  it('handles file with no frontmatter', () => {
    const md = '# Just a heading\n\nSome text.\n';
    const result = parseFrontmatter(md);
    assert.deepEqual(result.data, {});
    assert.ok(result.content.includes('# Just a heading'));
  });

  it('handles empty frontmatter', () => {
    const md = '---\n---\n\nBody here.\n';
    const result = parseFrontmatter(md);
    assert.deepEqual(result.data, {});
  });

  it('roundtrips frontmatter', () => {
    const data = { title: 'Hello', status: 'publish', count: 1 };
    const content = 'Body text\n';
    const output = stringifyFrontmatter(content, data);
    assert.ok(output.startsWith('---\n'));
    assert.ok(output.includes('title: Hello'));
    assert.ok(output.includes('Body text'));
  });
});

// ─── glob matcher tests ───────────────────────────────────────────────────────

describe('pipe — glob', () => {
  let isMatch: (path: string, pattern: string) => boolean;

  before(async () => {
    const mod = await import(join(process.cwd(), 'build', 'src', 'pipe', 'glob.js'));
    isMatch = mod.isMatch;
  });

  it('matches simple path', () => {
    assert.ok(isMatch('posts/foo.md', 'posts/**'));
  });

  it('matches nested path', () => {
    assert.ok(isMatch('posts/2024/foo.md', 'posts/**'));
  });

  it('does not match outside pattern', () => {
    assert.ok(!isMatch('drafts/foo.md', 'posts/**'));
  });

  it('matches *.md wildcard', () => {
    assert.ok(isMatch('README.md', '*.md'));
  });

  it('matches exact file', () => {
    assert.ok(isMatch('docs/guide.md', 'docs/guide.md'));
  });
});

// ─── matcher tests ────────────────────────────────────────────────────────────

describe('pipe — matcher', () => {
  let parseMarkdownContent: (content: string, filePath: string, relativePath: string) => unknown;
  let matchFrontmatter: (fm: Record<string, unknown>, expected: Record<string, unknown>) => boolean;
  let matchTags: (fileTags: string[], required: string[]) => boolean;
  let evaluateTrigger: (trigger: unknown, file: unknown) => unknown;

  before(async () => {
    const mod = await import(join(process.cwd(), 'build', 'src', 'pipe', 'matcher.js'));
    parseMarkdownContent = mod.parseMarkdownContent;
    matchFrontmatter = mod.matchFrontmatter;
    matchTags = mod.matchTags;
    evaluateTrigger = mod.evaluateTrigger;
  });

  it('parses frontmatter from markdown content', () => {
    const content = '---\nstatus: publish\ntitle: Hello\n---\n\nBody text\n';
    const file = parseMarkdownContent(content, '/tmp/test.md', 'test.md') as any;
    assert.equal(file.frontmatter['status'], 'publish');
    assert.equal(file.frontmatter['title'], 'Hello');
    assert.ok(file.body.includes('Body text'));
  });

  it('parses tags from frontmatter', () => {
    const content = '---\ntags:\n  - blog\n  - tech\n---\n\nBody\n';
    const file = parseMarkdownContent(content, '/tmp/test.md', 'test.md') as any;
    assert.deepEqual(file.tags, ['blog', 'tech']);
  });

  it('matchFrontmatter — exact match', () => {
    assert.ok(matchFrontmatter({ status: 'publish' }, { status: 'publish' }));
  });

  it('matchFrontmatter — mismatch', () => {
    assert.ok(!matchFrontmatter({ status: 'draft' }, { status: 'publish' }));
  });

  it('matchFrontmatter — negation prefix', () => {
    assert.ok(matchFrontmatter({ status: 'draft' }, { status: '!publish' }));
    assert.ok(!matchFrontmatter({ status: 'publish' }, { status: '!publish' }));
  });

  it('matchTags — subset match', () => {
    assert.ok(matchTags(['blog', 'tech', 'ai'], ['blog', 'tech']));
  });

  it('matchTags — missing tag', () => {
    assert.ok(!matchTags(['blog'], ['blog', 'tech']));
  });

  it('evaluateTrigger — path match returns result', () => {
    const trigger = { name: 'test', match: { path: 'posts/**' }, run: 'echo hi' };
    const file = {
      filePath: '/tmp/posts/foo.md',
      relativePath: 'posts/foo.md',
      content: '',
      body: '',
      frontmatter: {},
      tags: [],
    };
    const result = evaluateTrigger(trigger, file) as any;
    assert.ok(result !== null);
    assert.equal(result.trigger.name, 'test');
  });

  it('evaluateTrigger — path mismatch returns null', () => {
    const trigger = { name: 'test', match: { path: 'posts/**' }, run: 'echo hi' };
    const file = {
      filePath: '/tmp/drafts/foo.md',
      relativePath: 'drafts/foo.md',
      content: '',
      body: '',
      frontmatter: {},
      tags: [],
    };
    const result = evaluateTrigger(trigger, file);
    assert.equal(result, null);
  });

  it('evaluateTrigger — frontmatter match', () => {
    const trigger = {
      name: 'pub',
      match: { frontmatter: { status: 'publish' } },
      run: 'echo hi',
    };
    const file = {
      filePath: '/tmp/foo.md',
      relativePath: 'foo.md',
      content: '',
      body: '',
      frontmatter: { status: 'publish' },
      tags: [],
    };
    const result = evaluateTrigger(trigger, file);
    assert.ok(result !== null);
  });
});

// ─── template-vars tests ──────────────────────────────────────────────────────

describe('pipe — template-vars', () => {
  let buildContext: (...args: unknown[]) => unknown;
  let expandTemplate: (template: string, ctx: unknown) => string;

  before(async () => {
    const mod = await import(join(process.cwd(), 'build', 'src', 'pipe', 'template-vars.js'));
    buildContext = mod.buildContext;
    expandTemplate = mod.expandTemplate;
  });

  it('expands {{slug}}', () => {
    const ctx = buildContext('/tmp/posts/hello-world.md', 'posts/hello-world.md', '/tmp/posts', {}, [], '', '', null);
    const result = expandTemplate('Publishing {{slug}}', ctx);
    assert.equal(result, 'Publishing hello-world');
  });

  it('expands {{fm.title}}', () => {
    const ctx = buildContext('/tmp/foo.md', 'foo.md', '/tmp', { title: 'My Post' }, [], '', '', null);
    const result = expandTemplate('Title: {{fm.title}}', ctx);
    assert.equal(result, 'Title: My Post');
  });

  it('expands {{date}}', () => {
    const ctx = buildContext('/tmp/foo.md', 'foo.md', '/tmp', {}, [], '', '', null);
    const result = expandTemplate('{{date}}', ctx);
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('leaves unknown vars as-is', () => {
    const ctx = buildContext('/tmp/foo.md', 'foo.md', '/tmp', {}, [], '', '', null);
    const result = expandTemplate('{{unknown_var}}', ctx);
    assert.equal(result, '{{unknown_var}}');
  });
});

// ─── config loading tests ─────────────────────────────────────────────────────

describe('pipe — config', () => {
  let loadConfig: (path: string) => unknown;
  let generateDefaultConfig: () => string;
  let findConfigFile: (dir: string) => string | null;

  before(async () => {
    const mod = await import(join(process.cwd(), 'build', 'src', 'pipe', 'config.js'));
    loadConfig = mod.loadConfig;
    generateDefaultConfig = mod.generateDefaultConfig;
    findConfigFile = mod.findConfigFile;
    setup();
  });

  after(() => teardown());

  it('generateDefaultConfig returns valid string', () => {
    const cfg = generateDefaultConfig();
    assert.ok(cfg.includes('watch:'));
    assert.ok(cfg.includes('triggers:'));
  });

  it('findConfigFile finds .md-pipe.yml', () => {
    writeFileSync(join(TMP, '.md-pipe.yml'), generateDefaultConfig());
    const found = findConfigFile(TMP);
    assert.ok(found !== null);
    assert.ok(found!.includes('.md-pipe.yml'));
  });

  it('findConfigFile returns null when no config', () => {
    const found = findConfigFile(join(TMP, 'nonexistent'));
    assert.equal(found, null);
  });

  it('loadConfig parses triggers', () => {
    const cfgContent = `watch: ./docs\ntriggers:\n  - name: publish\n    match:\n      path: "posts/**"\n    run: "echo Publishing $FILE"\n`;
    const cfgPath = join(TMP, '.md-pipe.yml');
    writeFileSync(cfgPath, cfgContent);
    mkdirSync(DOCS, { recursive: true });
    const config = loadConfig(cfgPath) as any;
    assert.equal(config.triggers.length, 1);
    assert.equal(config.triggers[0].name, 'publish');
    assert.equal(config.triggers[0].run, 'echo Publishing $FILE');
    assert.equal(config.triggers[0].match.path, 'posts/**');
  });

  it('loadConfig throws if no watch key', () => {
    const cfgPath = join(TMP, 'bad.yml');
    writeFileSync(cfgPath, 'triggers:\n  - name: t\n    match:\n      path: "**"\n    run: echo hi\n');
    assert.throws(() => loadConfig(cfgPath), /watch/);
  });

  it('loadConfig throws if no triggers or pipelines', () => {
    const cfgPath = join(TMP, 'empty.yml');
    writeFileSync(cfgPath, 'watch: ./docs\n');
    assert.throws(() => loadConfig(cfgPath));
  });
});

// ─── state tests ──────────────────────────────────────────────────────────────

describe('pipe — state', () => {
  let loadState: (path: string) => unknown;
  let saveState: (path: string, state: unknown) => void;
  let hasChanged: (state: unknown, trigger: string, rel: string, content: string) => boolean;
  let markProcessed: (state: unknown, trigger: string, rel: string, content: string) => void;
  let computeFileHash: (content: string) => string;

  before(async () => {
    const mod = await import(join(process.cwd(), 'build', 'src', 'pipe', 'state.js'));
    loadState = mod.loadState;
    saveState = mod.saveState;
    hasChanged = mod.hasChanged;
    markProcessed = mod.markProcessed;
    computeFileHash = mod.computeFileHash;
    setup();
  });

  after(() => teardown());

  it('loadState returns empty state for nonexistent file', () => {
    const state = loadState(join(TMP, 'nonexistent.json')) as any;
    assert.equal(state.version, 1);
    assert.deepEqual(state.entries, {});
  });

  it('computeFileHash returns 16-char hex string', () => {
    const hash = computeFileHash('hello world');
    assert.match(hash, /^[0-9a-f]{16}$/);
  });

  it('hasChanged returns true for new file', () => {
    const state = { version: 1, entries: {} };
    assert.ok(hasChanged(state, 'trigger', 'foo.md', 'content'));
  });

  it('hasChanged returns false after markProcessed', () => {
    const state = { version: 1 as const, entries: {} };
    markProcessed(state, 'trigger', 'foo.md', 'content');
    assert.ok(!hasChanged(state, 'trigger', 'foo.md', 'content'));
  });

  it('hasChanged returns true after content change', () => {
    const state = { version: 1 as const, entries: {} };
    markProcessed(state, 'trigger', 'foo.md', 'old content');
    assert.ok(hasChanged(state, 'trigger', 'foo.md', 'new content'));
  });

  it('saveState and loadState roundtrip', () => {
    const statePath = join(TMP, 'state.json');
    const state = { version: 1 as const, entries: {} };
    markProcessed(state, 'trigger', 'foo.md', 'content');
    saveState(statePath, state);

    const loaded = loadState(statePath) as any;
    assert.equal(loaded.version, 1);
    assert.ok('trigger::foo.md' in loaded.entries);
    assert.ok(!hasChanged(loaded, 'trigger', 'foo.md', 'content'));
  });
});

// ─── CLI pipe subcommand integration tests ────────────────────────────────────

describe('pipe — CLI integration', () => {
  before(() => {
    setup();
    mkdirSync(DOCS, { recursive: true });
  });

  after(() => teardown());

  it('pipe --help shows usage', () => {
    const { stdout, exitCode } = run('pipe --help');
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('md-kit pipe'));
    assert.ok(stdout.includes('watch'));
    assert.ok(stdout.includes('once'));
  });

  it('pipe init creates .md-pipe.yml', () => {
    const { exitCode } = run('pipe init');
    assert.equal(exitCode, 0);
    assert.ok(existsSync(join(TMP, '.md-pipe.yml')));
  });

  it('pipe init fails if .md-pipe.yml already exists', () => {
    const { exitCode } = run('pipe init');
    assert.equal(exitCode, 1);
  });

  it('pipe once with trigger runs against matching files', () => {
    // Write a config that matches all .md files
    const cfg = `watch: ./docs\ntriggers:\n  - name: echo-all\n    match:\n      path: "**/*.md"\n    run: "echo MATCHED $FILE"\n`;
    writeFileSync(join(TMP, '.md-pipe.yml'), cfg);
    writeFileSync(join(DOCS, 'test.md'), '# Hello\n');

    const { stdout, exitCode } = run('pipe once');
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('scanned'));
  });

  it('pipe once --dry-run does not execute commands', () => {
    const cfg = `watch: ./docs\ntriggers:\n  - name: drytest\n    match:\n      path: "**/*.md"\n    run: "echo EXECUTED"\n`;
    writeFileSync(join(TMP, '.md-pipe.yml'), cfg);
    writeFileSync(join(DOCS, 'dry.md'), '# Dry\n');

    const { stdout } = run('pipe once --dry-run');
    assert.ok(stdout.includes('dry-run'));
  });

  it('pipe once --json outputs valid JSON', () => {
    const cfg = `watch: ./docs\ntriggers:\n  - name: jsontest\n    match:\n      path: "**/*.md"\n    run: "echo hello"\n`;
    writeFileSync(join(TMP, '.md-pipe.yml'), cfg);
    writeFileSync(join(DOCS, 'json.md'), '# JSON\n');

    const { stdout, exitCode } = run('pipe once --json');
    assert.equal(exitCode, 0);
    const data = JSON.parse(stdout);
    assert.ok('total' in data);
    assert.ok('matched' in data);
    assert.ok('actions' in data);
  });

  it('pipe test shows matching triggers for a file', () => {
    const cfg = `watch: ./docs\ntriggers:\n  - name: testmatch\n    match:\n      path: "**/*.md"\n    run: "echo hi"\n`;
    writeFileSync(join(TMP, '.md-pipe.yml'), cfg);
    const testFilePath = join(DOCS, 'testfile.md');
    writeFileSync(testFilePath, '# Test\n');

    const { stdout, exitCode } = run(`pipe test ${testFilePath}`);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('testmatch') || stdout.includes('testfile'));
  });

  it('pipe test --json returns valid JSON', () => {
    const cfg = `watch: ./docs\ntriggers:\n  - name: jsonmatch\n    match:\n      path: "**/*.md"\n    run: "echo hi"\n`;
    writeFileSync(join(TMP, '.md-pipe.yml'), cfg);
    const testFilePath = join(DOCS, 'jsontest.md');
    writeFileSync(testFilePath, '# JSON Test\n');

    const { stdout, exitCode } = run(`pipe test ${testFilePath} --json`);
    assert.equal(exitCode, 0);
    const data = JSON.parse(stdout);
    assert.ok('matches' in data);
    assert.ok(Array.isArray(data.matches));
  });

  it('pipe run errors on missing pipeline', () => {
    const cfg = `watch: ./docs\ntriggers:\n  - name: existing\n    match:\n      path: "**"\n    run: "echo hi"\n`;
    writeFileSync(join(TMP, '.md-pipe.yml'), cfg);

    const { exitCode, stdout } = run('pipe run nonexistent');
    assert.equal(exitCode, 1);
    assert.ok(stdout.includes('not found') || stdout.includes('nonexistent') || stdout.includes('nonexistent'));
  });

  it('pipe once with frontmatter-matched trigger', () => {
    const cfg = `watch: ./docs\ntriggers:\n  - name: publish-only\n    match:\n      frontmatter:\n        status: publish\n    run: "echo PUB"\n`;
    writeFileSync(join(TMP, '.md-pipe.yml'), cfg);
    writeFileSync(join(DOCS, 'published.md'), '---\nstatus: publish\n---\n\n# Published\n');
    writeFileSync(join(DOCS, 'draft.md'), '---\nstatus: draft\n---\n\n# Draft\n');

    const { stdout, exitCode } = run('pipe once --json');
    assert.equal(exitCode, 0);
    const data = JSON.parse(stdout);
    // Only the publish file should match
    assert.equal(data.matched, 1);
  });

  it('pipe unknown subcommand exits 1', () => {
    const { exitCode } = run('pipe foobar');
    assert.equal(exitCode, 1);
  });
});

// ─── pipe command in main help ────────────────────────────────────────────────

describe('pipe — help integration', () => {
  it('main --help mentions pipe', () => {
    // Use a standalone exec that doesn't depend on TMP
    try {
      const stdout = execSync(`node ${CLI} --help`, {
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
      });
      assert.ok(stdout.includes('pipe'));
    } catch (e: any) {
      assert.ok((e.stdout ?? '').includes('pipe'));
    }
  });
});
