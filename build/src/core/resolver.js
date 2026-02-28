"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findBrokenLinks = findBrokenLinks;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/**
 * Simple Levenshtein distance
 */
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++)
        dp[i][0] = i;
    for (let j = 0; j <= n; j++)
        dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}
/**
 * Find the best fuzzy match for a target among known files
 */
function findSuggestion(target, allFiles) {
    const targetLower = target.toLowerCase();
    let bestMatch = null;
    let bestDist = Infinity;
    for (const file of allFiles) {
        // Compare against filename without extension and full relative path
        const baseName = file.replace(/\.md$/, '');
        const baseNameOnly = baseName.split('/').pop() ?? baseName;
        const dist = Math.min(levenshtein(targetLower, baseNameOnly.toLowerCase()), levenshtein(targetLower, baseName.toLowerCase()));
        if (dist < bestDist && dist <= Math.max(3, Math.floor(target.length * 0.4))) {
            bestDist = dist;
            bestMatch = baseNameOnly;
        }
    }
    return bestMatch;
}
/**
 * Resolve a wikilink against the list of known .md files
 */
function resolveWikilink(target, allFiles) {
    const targetLower = target.toLowerCase();
    return allFiles.some(f => {
        const baseName = f.replace(/\.md$/, '');
        const baseNameOnly = baseName.split('/').pop() ?? baseName;
        return baseNameOnly.toLowerCase() === targetLower || baseName.toLowerCase() === targetLower;
    });
}
/**
 * Resolve a relative link against the filesystem
 */
function resolveRelativeLink(target, fromFile, baseDir) {
    const dir = (0, node_path_1.dirname)((0, node_path_1.join)(baseDir, fromFile));
    const resolved = (0, node_path_1.join)(dir, target);
    return (0, node_fs_1.existsSync)(resolved);
}
/**
 * Check all extracted links, return broken ones with suggestions
 */
function findBrokenLinks(links, allFiles, baseDir) {
    const broken = [];
    for (const link of links) {
        let isValid = false;
        if (link.type === 'wikilink') {
            isValid = resolveWikilink(link.target, allFiles);
        }
        else {
            isValid = resolveRelativeLink(link.target, link.file, baseDir);
        }
        if (!isValid) {
            broken.push({
                ...link,
                suggestion: findSuggestion(link.target, allFiles),
            });
        }
    }
    return broken;
}
