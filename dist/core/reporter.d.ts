import { BrokenLink } from './resolver.js';
export interface JsonReport {
    totalFiles: number;
    totalLinks: number;
    brokenLinks: number;
    results: Array<{
        file: string;
        line: number;
        link: string;
        type: string;
        suggestion: string | null;
    }>;
}
/**
 * Format broken links as a colored table for terminal output
 */
export declare function formatTable(broken: BrokenLink[], totalFiles: number, totalLinks: number): string;
/**
 * Format broken links as JSON
 */
export declare function formatJson(broken: BrokenLink[], totalFiles: number, totalLinks: number): JsonReport;
