import { ExtractedLink } from './scanner.js';
export interface BrokenLink extends ExtractedLink {
    suggestion: string | null;
}
/**
 * Check all extracted links, return broken ones with suggestions
 */
export declare function findBrokenLinks(links: ExtractedLink[], allFiles: string[], baseDir: string): BrokenLink[];
