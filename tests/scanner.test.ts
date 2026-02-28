import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, findMarkdownFiles } from '../src/core/scanner.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TMP = join(process.cwd(), '.test-tmp-scanner');

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

describe('extractLinks', () => {
  it('extracts [[wikilinks]]', () => {
    const content = 'See [[NOW]] for details and [[daily/2026-01-01]] too.';
    const links = extractLinks('test.md', content);
    assert.equal(links.length, 2);
    assert.equal(links[0].target, 'NOW');
    assert.equal(links[0].type, 'wikilink');
    assert.equal(links[1].target, 'daily/2026-01-01');
  });

  it('extracts [[wikilink|alias]]', () => {
    const content = 'See [[NOW|current status]] for more.';
    const links = extractLinks('test.md', content);
    assert.equal(links.length, 1);
    assert.equal(links[0].target, 'NOW');
  });

  it('extracts [[wikilink#heading]]', () => {
    const content = 'Go to [[README#install]] section.';
    const links = extractLinks('test.md', content);
    assert.equal(links.length, 1);
    assert.equal(links[0].target, 'README');
  });

  it('extracts [text](relative-path) links', () => {
    const content = 'Read the [guide](./docs/guide.md) and [faq](faq.md).';
    const links = extractLinks('test.md', content);
    assert.equal(links.length, 2);
    assert.equal(links[0].target, './docs/guide.md');
    assert.equal(links[0].type, 'relative');
    assert.equal(links[1].target, 'faq.md');
  });

  it('skips http/https URLs', () => {
    const content = 'Visit [site](https://example.com) and [api](http://api.com).';
    const links = extractLinks('test.md', content);
    assert.equal(links.length, 0);
  });

  it('skips mailto links', () => {
    const content = 'Email [us](mailto:test@example.com).';
    const links = extractLinks('test.md', content);
    assert.equal(links.length, 0);
  });

  it('skips anchor-only links', () => {
    const content = 'Jump to [section](#heading).';
    const links = extractLinks('test.md', content);
    assert.equal(links.length, 0);
  });

  it('skips image embeds ![[image]]', () => {
    const content = 'Here is ![[screenshot.png]] and [[valid-link]].';
    const links = extractLinks('test.md', content);
    assert.equal(links.length, 1);
    assert.equal(links[0].target, 'valid-link');
  });

  it('handles mixed links on one line', () => {
    const content = 'See [[foo]] and [bar](bar.md) and [[baz]].';
    const links = extractLinks('test.md', content);
    assert.equal(links.length, 3);
  });

  it('tracks correct line numbers', () => {
    const content = 'line 1\n[[link-on-two]]\nline 3\n[x](y.md)';
    const links = extractLinks('test.md', content);
    assert.equal(links[0].line, 2);
    assert.equal(links[1].line, 4);
  });
});

describe('findMarkdownFiles', () => {
  it('finds .md files recursively', () => {
    setup();
    mkdirSync(join(TMP, 'sub'), { recursive: true });
    writeFileSync(join(TMP, 'a.md'), '# A');
    writeFileSync(join(TMP, 'b.txt'), 'not md');
    writeFileSync(join(TMP, 'sub', 'c.md'), '# C');

    const files = findMarkdownFiles(TMP);
    assert.equal(files.length, 2);
    assert.ok(files.includes('a.md'));
    assert.ok(files.includes(join('sub', 'c.md')));
    teardown();
  });

  it('skips node_modules and dotdirs', () => {
    setup();
    mkdirSync(join(TMP, 'node_modules'), { recursive: true });
    mkdirSync(join(TMP, '.git'), { recursive: true });
    writeFileSync(join(TMP, 'a.md'), '# A');
    writeFileSync(join(TMP, 'node_modules', 'b.md'), '# B');
    writeFileSync(join(TMP, '.git', 'c.md'), '# C');

    const files = findMarkdownFiles(TMP);
    assert.equal(files.length, 1);
    assert.equal(files[0], 'a.md');
    teardown();
  });

  it('returns empty for empty directory', () => {
    setup();
    const files = findMarkdownFiles(TMP);
    assert.equal(files.length, 0);
    teardown();
  });
});
