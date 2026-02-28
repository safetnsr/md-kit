"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const resolver_js_1 = require("../src/core/resolver.js");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const TMP = (0, node_path_1.join)(process.cwd(), '.test-tmp-resolver');
function setup() {
    (0, node_fs_1.rmSync)(TMP, { recursive: true, force: true });
    (0, node_fs_1.mkdirSync)(TMP, { recursive: true });
}
function teardown() {
    (0, node_fs_1.rmSync)(TMP, { recursive: true, force: true });
}
(0, node_test_1.describe)('findBrokenLinks', () => {
    (0, node_test_1.it)('resolves valid wikilinks', () => {
        const allFiles = ['README.md', 'notes/daily.md'];
        const links = [
            { file: 'index.md', line: 1, raw: '[[README]]', target: 'README', type: 'wikilink' },
            { file: 'index.md', line: 2, raw: '[[daily]]', target: 'daily', type: 'wikilink' },
        ];
        const broken = (0, resolver_js_1.findBrokenLinks)(links, allFiles, TMP);
        strict_1.default.equal(broken.length, 0);
    });
    (0, node_test_1.it)('detects broken wikilinks', () => {
        const allFiles = ['README.md'];
        const links = [
            { file: 'index.md', line: 1, raw: '[[MISSING]]', target: 'MISSING', type: 'wikilink' },
        ];
        const broken = (0, resolver_js_1.findBrokenLinks)(links, allFiles, TMP);
        strict_1.default.equal(broken.length, 1);
        strict_1.default.equal(broken[0].target, 'MISSING');
    });
    (0, node_test_1.it)('resolves valid relative links', () => {
        setup();
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'index.md'), '');
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'guide.md'), '');
        const allFiles = ['index.md', 'guide.md'];
        const links = [
            { file: 'index.md', line: 1, raw: '[guide](guide.md)', target: 'guide.md', type: 'relative' },
        ];
        const broken = (0, resolver_js_1.findBrokenLinks)(links, allFiles, TMP);
        strict_1.default.equal(broken.length, 0);
        teardown();
    });
    (0, node_test_1.it)('detects broken relative links', () => {
        setup();
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'index.md'), '');
        const allFiles = ['index.md'];
        const links = [
            { file: 'index.md', line: 1, raw: '[x](missing.md)', target: 'missing.md', type: 'relative' },
        ];
        const broken = (0, resolver_js_1.findBrokenLinks)(links, allFiles, TMP);
        strict_1.default.equal(broken.length, 1);
        teardown();
    });
    (0, node_test_1.it)('provides fuzzy suggestions for broken wikilinks', () => {
        const allFiles = ['README.md', 'NOW.md'];
        const links = [
            { file: 'index.md', line: 1, raw: '[[RAEDME]]', target: 'RAEDME', type: 'wikilink' },
        ];
        const broken = (0, resolver_js_1.findBrokenLinks)(links, allFiles, TMP);
        strict_1.default.equal(broken.length, 1);
        strict_1.default.equal(broken[0].suggestion, 'README');
    });
    (0, node_test_1.it)('case-insensitive wikilink resolution', () => {
        const allFiles = ['Memory.md', 'notes/Daily.md'];
        const links = [
            { file: 'index.md', line: 1, raw: '[[memory]]', target: 'memory', type: 'wikilink' },
            { file: 'index.md', line: 2, raw: '[[daily]]', target: 'daily', type: 'wikilink' },
        ];
        const broken = (0, resolver_js_1.findBrokenLinks)(links, allFiles, TMP);
        strict_1.default.equal(broken.length, 0);
    });
    (0, node_test_1.it)('no suggestion when no close match exists', () => {
        const allFiles = ['README.md'];
        const links = [
            { file: 'index.md', line: 1, raw: '[[zzzzzzz]]', target: 'zzzzzzz', type: 'wikilink' },
        ];
        const broken = (0, resolver_js_1.findBrokenLinks)(links, allFiles, TMP);
        strict_1.default.equal(broken.length, 1);
        strict_1.default.equal(broken[0].suggestion, null);
    });
});
