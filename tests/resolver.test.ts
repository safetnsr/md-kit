import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findBrokenLinks, BrokenLink } from '../src/core/resolver.js';
import { ExtractedLink } from '../src/core/scanner.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TMP = join(process.cwd(), '.test-tmp-resolver');

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

describe('findBrokenLinks', () => {
  it('resolves valid wikilinks', () => {
    const allFiles = ['README.md', 'notes/daily.md'];
    const links: ExtractedLink[] = [
      { file: 'index.md', line: 1, raw: '[[README]]', target: 'README', type: 'wikilink' },
      { file: 'index.md', line: 2, raw: '[[daily]]', target: 'daily', type: 'wikilink' },
    ];
    const broken = findBrokenLinks(links, allFiles, TMP);
    assert.equal(broken.length, 0);
  });

  it('detects broken wikilinks', () => {
    const allFiles = ['README.md'];
    const links: ExtractedLink[] = [
      { file: 'index.md', line: 1, raw: '[[MISSING]]', target: 'MISSING', type: 'wikilink' },
    ];
    const broken = findBrokenLinks(links, allFiles, TMP);
    assert.equal(broken.length, 1);
    assert.equal(broken[0].target, 'MISSING');
  });

  it('resolves valid relative links', () => {
    setup();
    writeFileSync(join(TMP, 'index.md'), '');
    writeFileSync(join(TMP, 'guide.md'), '');

    const allFiles = ['index.md', 'guide.md'];
    const links: ExtractedLink[] = [
      { file: 'index.md', line: 1, raw: '[guide](guide.md)', target: 'guide.md', type: 'relative' },
    ];
    const broken = findBrokenLinks(links, allFiles, TMP);
    assert.equal(broken.length, 0);
    teardown();
  });

  it('detects broken relative links', () => {
    setup();
    writeFileSync(join(TMP, 'index.md'), '');

    const allFiles = ['index.md'];
    const links: ExtractedLink[] = [
      { file: 'index.md', line: 1, raw: '[x](missing.md)', target: 'missing.md', type: 'relative' },
    ];
    const broken = findBrokenLinks(links, allFiles, TMP);
    assert.equal(broken.length, 1);
    teardown();
  });

  it('provides fuzzy suggestions for broken wikilinks', () => {
    const allFiles = ['README.md', 'NOW.md'];
    const links: ExtractedLink[] = [
      { file: 'index.md', line: 1, raw: '[[RAEDME]]', target: 'RAEDME', type: 'wikilink' },
    ];
    const broken = findBrokenLinks(links, allFiles, TMP);
    assert.equal(broken.length, 1);
    assert.equal(broken[0].suggestion, 'README');
  });

  it('case-insensitive wikilink resolution', () => {
    const allFiles = ['Memory.md', 'notes/Daily.md'];
    const links: ExtractedLink[] = [
      { file: 'index.md', line: 1, raw: '[[memory]]', target: 'memory', type: 'wikilink' },
      { file: 'index.md', line: 2, raw: '[[daily]]', target: 'daily', type: 'wikilink' },
    ];
    const broken = findBrokenLinks(links, allFiles, TMP);
    assert.equal(broken.length, 0);
  });

  it('no suggestion when no close match exists', () => {
    const allFiles = ['README.md'];
    const links: ExtractedLink[] = [
      { file: 'index.md', line: 1, raw: '[[zzzzzzz]]', target: 'zzzzzzz', type: 'wikilink' },
    ];
    const broken = findBrokenLinks(links, allFiles, TMP);
    assert.equal(broken.length, 1);
    assert.equal(broken[0].suggestion, null);
  });
});
