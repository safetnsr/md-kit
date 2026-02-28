export interface ExtractedLink {
    file: string;
    line: number;
    raw: string;
    target: string;
    type: 'wikilink' | 'relative';
}
/**
 * Recursively find all .md files in a directory
 */
export declare function findMarkdownFiles(dir: string, baseDir?: string): string[];
/**
 * Extract all [[wikilinks]] and [text](relative-path) links from a markdown file
 */
export declare function extractLinks(filePath: string, content: string): ExtractedLink[];
/**
 * Read file content safely
 */
export declare function readFile(path: string): string | null;
