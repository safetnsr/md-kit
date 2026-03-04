/**
 * Minimal frontmatter parser — replaces gray-matter.
 * Parses YAML front matter delimited by ---
 * Zero external dependencies.
 */

import { parseYaml } from './yaml-parser.js';

export interface ParsedFile {
  data: Record<string, unknown>;
  content: string;
  /** Full original content */
  orig: string;
}

/**
 * Parse a markdown file's frontmatter and body.
 */
export function parseFrontmatter(input: string): ParsedFile {
  const orig = input;

  // Must start with ---
  if (!input.startsWith('---')) {
    return { data: {}, content: input, orig };
  }

  // Find the closing ---
  const rest = input.slice(3);
  const endIdx = rest.indexOf('\n---');
  if (endIdx === -1) {
    return { data: {}, content: input, orig };
  }

  const yamlStr = rest.slice(0, endIdx).trim();
  const body = rest.slice(endIdx + 4); // skip \n---

  let data: Record<string, unknown> = {};
  if (yamlStr) {
    try {
      const parsed = parseYaml(yamlStr);
      if (parsed && typeof parsed === 'object') {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // Invalid frontmatter — treat as no frontmatter
    }
  }

  // Remove leading newline from body
  const content = body.startsWith('\n') ? body.slice(1) : body;

  return { data, content, orig };
}

/**
 * Serialize data back to frontmatter + body string.
 * Mimics gray-matter.stringify.
 */
export function stringifyFrontmatter(content: string, data: Record<string, unknown>): string {
  const yaml = serializeYaml(data);
  return `---\n${yaml}---\n${content}`;
}

function serializeYaml(obj: Record<string, unknown>, indent = 0): string {
  const pad = ' '.repeat(indent);
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    out += `${pad}${k}: ${serializeValue(v, indent)}\n`;
  }
  return out;
}

function serializeValue(v: unknown, indent: number): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // Quote if contains special chars
    if (v.includes(':') || v.includes('#') || v.includes("'") || v.startsWith(' ') || v.endsWith(' ') || v === '') {
      return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '\n' + v.map(item => `${' '.repeat(indent + 2)}- ${serializeValue(item, indent + 2)}`).join('\n');
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    return '\n' + serializeYaml(obj, indent + 2);
  }
  return String(v);
}
