"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const scanner_js_1 = require("../src/core/scanner.js");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const TMP = (0, node_path_1.join)(process.cwd(), '.test-tmp-scanner');
function setup() {
    (0, node_fs_1.rmSync)(TMP, { recursive: true, force: true });
    (0, node_fs_1.mkdirSync)(TMP, { recursive: true });
}
function teardown() {
    (0, node_fs_1.rmSync)(TMP, { recursive: true, force: true });
}
(0, node_test_1.describe)('extractLinks', () => {
    (0, node_test_1.it)('extracts [[wikilinks]]', () => {
        const content = 'See [[NOW]] for details and [[daily/2026-01-01]] too.';
        const links = (0, scanner_js_1.extractLinks)('test.md', content);
        strict_1.default.equal(links.length, 2);
        strict_1.default.equal(links[0].target, 'NOW');
        strict_1.default.equal(links[0].type, 'wikilink');
        strict_1.default.equal(links[1].target, 'daily/2026-01-01');
    });
    (0, node_test_1.it)('extracts [[wikilink|alias]]', () => {
        const content = 'See [[NOW|current status]] for more.';
        const links = (0, scanner_js_1.extractLinks)('test.md', content);
        strict_1.default.equal(links.length, 1);
        strict_1.default.equal(links[0].target, 'NOW');
    });
    (0, node_test_1.it)('extracts [[wikilink#heading]]', () => {
        const content = 'Go to [[README#install]] section.';
        const links = (0, scanner_js_1.extractLinks)('test.md', content);
        strict_1.default.equal(links.length, 1);
        strict_1.default.equal(links[0].target, 'README');
    });
    (0, node_test_1.it)('extracts [text](relative-path) links', () => {
        const content = 'Read the [guide](./docs/guide.md) and [faq](faq.md).';
        const links = (0, scanner_js_1.extractLinks)('test.md', content);
        strict_1.default.equal(links.length, 2);
        strict_1.default.equal(links[0].target, './docs/guide.md');
        strict_1.default.equal(links[0].type, 'relative');
        strict_1.default.equal(links[1].target, 'faq.md');
    });
    (0, node_test_1.it)('skips http/https URLs', () => {
        const content = 'Visit [site](https://example.com) and [api](http://api.com).';
        const links = (0, scanner_js_1.extractLinks)('test.md', content);
        strict_1.default.equal(links.length, 0);
    });
    (0, node_test_1.it)('skips mailto links', () => {
        const content = 'Email [us](mailto:test@example.com).';
        const links = (0, scanner_js_1.extractLinks)('test.md', content);
        strict_1.default.equal(links.length, 0);
    });
    (0, node_test_1.it)('skips anchor-only links', () => {
        const content = 'Jump to [section](#heading).';
        const links = (0, scanner_js_1.extractLinks)('test.md', content);
        strict_1.default.equal(links.length, 0);
    });
    (0, node_test_1.it)('skips image embeds ![[image]]', () => {
        const content = 'Here is ![[screenshot.png]] and [[valid-link]].';
        const links = (0, scanner_js_1.extractLinks)('test.md', content);
        strict_1.default.equal(links.length, 1);
        strict_1.default.equal(links[0].target, 'valid-link');
    });
    (0, node_test_1.it)('handles mixed links on one line', () => {
        const content = 'See [[foo]] and [bar](bar.md) and [[baz]].';
        const links = (0, scanner_js_1.extractLinks)('test.md', content);
        strict_1.default.equal(links.length, 3);
    });
    (0, node_test_1.it)('tracks correct line numbers', () => {
        const content = 'line 1\n[[link-on-two]]\nline 3\n[x](y.md)';
        const links = (0, scanner_js_1.extractLinks)('test.md', content);
        strict_1.default.equal(links[0].line, 2);
        strict_1.default.equal(links[1].line, 4);
    });
});
(0, node_test_1.describe)('findMarkdownFiles', () => {
    (0, node_test_1.it)('finds .md files recursively', () => {
        setup();
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(TMP, 'sub'), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'a.md'), '# A');
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'b.txt'), 'not md');
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'sub', 'c.md'), '# C');
        const files = (0, scanner_js_1.findMarkdownFiles)(TMP);
        strict_1.default.equal(files.length, 2);
        strict_1.default.ok(files.includes('a.md'));
        strict_1.default.ok(files.includes((0, node_path_1.join)('sub', 'c.md')));
        teardown();
    });
    (0, node_test_1.it)('skips node_modules and dotdirs', () => {
        setup();
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(TMP, 'node_modules'), { recursive: true });
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(TMP, '.git'), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'a.md'), '# A');
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'node_modules', 'b.md'), '# B');
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, '.git', 'c.md'), '# C');
        const files = (0, scanner_js_1.findMarkdownFiles)(TMP);
        strict_1.default.equal(files.length, 1);
        strict_1.default.equal(files[0], 'a.md');
        teardown();
    });
    (0, node_test_1.it)('returns empty for empty directory', () => {
        setup();
        const files = (0, scanner_js_1.findMarkdownFiles)(TMP);
        strict_1.default.equal(files.length, 0);
        teardown();
    });
});
