"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findMarkdownFiles = findMarkdownFiles;
exports.extractLinks = extractLinks;
exports.readFile = readFile;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/**
 * Recursively find all .md files in a directory
 */
function findMarkdownFiles(dir, baseDir) {
    const base = baseDir ?? dir;
    const results = [];
    let entries;
    try {
        entries = (0, node_fs_1.readdirSync)(dir);
    }
    catch {
        return results;
    }
    for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules')
            continue;
        const full = (0, node_path_1.join)(dir, entry);
        let stat;
        try {
            stat = (0, node_fs_1.statSync)(full);
        }
        catch {
            continue;
        }
        if (stat.isDirectory()) {
            results.push(...findMarkdownFiles(full, base));
        }
        else if (entry.endsWith('.md')) {
            results.push((0, node_path_1.relative)(base, full));
        }
    }
    return results;
}
/**
 * Extract all [[wikilinks]] and [text](relative-path) links from a markdown file
 */
function extractLinks(filePath, content) {
    const links = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match [[wikilinks]] — but not ![[embeds]] image syntax
        const wikiRe = /(?<!!)\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*?)?\]\]/g;
        let match;
        while ((match = wikiRe.exec(line)) !== null) {
            links.push({
                file: filePath,
                line: i + 1,
                raw: match[0],
                target: match[1].trim(),
                type: 'wikilink',
            });
        }
        // Match [text](relative-path) — skip http/https/mailto URLs and anchors
        const relRe = /\[([^\]]*)\]\(([^)]+)\)/g;
        while ((match = relRe.exec(line)) !== null) {
            const href = match[2].trim();
            // Skip external URLs, anchors, and data URIs
            if (/^(https?:|mailto:|#|data:)/.test(href))
                continue;
            // Strip anchor from path
            const target = href.split('#')[0];
            if (!target)
                continue;
            links.push({
                file: filePath,
                line: i + 1,
                raw: match[0],
                target,
                type: 'relative',
            });
        }
    }
    return links;
}
/**
 * Read file content safely
 */
function readFile(path) {
    try {
        return (0, node_fs_1.readFileSync)(path, 'utf-8');
    }
    catch {
        return null;
    }
}
