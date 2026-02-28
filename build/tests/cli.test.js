"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const CLI = (0, node_path_1.join)(process.cwd(), 'build', 'src', 'cli.js');
const TMP = (0, node_path_1.join)(process.cwd(), '.test-tmp-cli');
function run(args) {
    try {
        const stdout = (0, node_child_process_1.execSync)(`node ${CLI} ${args}`, { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
        return { stdout, exitCode: 0 };
    }
    catch (e) {
        return { stdout: e.stdout ?? '', exitCode: e.status ?? 1 };
    }
}
function setup() {
    (0, node_fs_1.rmSync)(TMP, { recursive: true, force: true });
    (0, node_fs_1.mkdirSync)(TMP, { recursive: true });
}
function teardown() {
    (0, node_fs_1.rmSync)(TMP, { recursive: true, force: true });
}
(0, node_test_1.describe)('CLI', () => {
    (0, node_test_1.it)('--help shows usage', () => {
        const { stdout, exitCode } = run('--help');
        strict_1.default.equal(exitCode, 0);
        strict_1.default.ok(stdout.includes('md-kit'));
        strict_1.default.ok(stdout.includes('check'));
    });
    (0, node_test_1.it)('--version shows version', () => {
        const { stdout, exitCode } = run('--version');
        strict_1.default.equal(exitCode, 0);
        strict_1.default.ok(stdout.includes('0.1.0'));
    });
    (0, node_test_1.it)('check with no broken links exits 0', () => {
        setup();
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'a.md'), '# Hello\n[[b]]\n');
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'b.md'), '# B\n');
        const { exitCode, stdout } = run(`check ${TMP}`);
        strict_1.default.equal(exitCode, 0);
        strict_1.default.ok(stdout.includes('all links valid'));
        teardown();
    });
    (0, node_test_1.it)('check with broken links exits 1', () => {
        setup();
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'a.md'), '# Hello\n[[missing]]\n');
        const { exitCode, stdout } = run(`check ${TMP}`);
        strict_1.default.equal(exitCode, 1);
        strict_1.default.ok(stdout.includes('broken'));
        teardown();
    });
    (0, node_test_1.it)('--json outputs valid JSON', () => {
        setup();
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'a.md'), '# Hello\n[[missing]]\n');
        const { stdout } = run(`check ${TMP} --json`);
        const data = JSON.parse(stdout);
        strict_1.default.equal(data.brokenLinks, 1);
        strict_1.default.equal(data.results[0].type, 'wikilink');
        strict_1.default.equal(data.results[0].link, 'missing');
        teardown();
    });
    (0, node_test_1.it)('--json with no broken links', () => {
        setup();
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(TMP, 'a.md'), '# Hello\n');
        const { stdout, exitCode } = run(`check ${TMP} --json`);
        const data = JSON.parse(stdout);
        strict_1.default.equal(exitCode, 0);
        strict_1.default.equal(data.brokenLinks, 0);
        strict_1.default.equal(data.results.length, 0);
        teardown();
    });
    (0, node_test_1.it)('empty directory shows no files', () => {
        setup();
        const { stdout, exitCode } = run(`check ${TMP}`);
        strict_1.default.equal(exitCode, 0);
        strict_1.default.ok(stdout.includes('No markdown files'));
        teardown();
    });
    (0, node_test_1.it)('unknown command exits 1', () => {
        const { exitCode } = run('foobar');
        strict_1.default.equal(exitCode, 1);
    });
});
