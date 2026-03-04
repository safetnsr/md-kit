/**
 * Minimal YAML parser for md-pipe config files.
 * Supports: scalars, quoted strings, arrays (block + flow), block mappings, flow mappings.
 * Zero external dependencies — uses only Node built-ins.
 */

export type YamlPrimitive = string | number | boolean | null;
export type YamlValue = YamlPrimitive | YamlArray | YamlObject;
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface YamlArray extends Array<YamlValue> {}
export interface YamlObject { [key: string]: YamlValue }

/**
 * Parse a YAML string into a plain JS object.
 * Sufficient for .md-pipe.yml config files.
 */
export function parseYaml(text: string): Record<string, YamlValue> {
  const lines = text.split('\n');
  const result = parseBlock(lines, 0, 0);
  return result.value as Record<string, YamlValue>;
}

interface ParseResult {
  value: YamlValue;
  nextLine: number;
}

/** Strip inline comments (# ...) outside of quotes */
function stripComment(s: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === '#' && !inSingle && !inDouble && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

function getIndent(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i;
}

function isBlankOrComment(line: string): boolean {
  const t = line.trimStart();
  return t === '' || t.startsWith('#');
}

/** Parse a scalar value from a string */
function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  // Quoted string
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  // Flow sequence: [a, b, c]
  if (s.startsWith('[') && s.endsWith(']')) {
    return parseFlowSequence(s);
  }
  // Flow mapping: {key: val, key2: val2}
  if (s.startsWith('{') && s.endsWith('}')) {
    return parseFlowMapping(s);
  }
  // Number
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function parseFlowSequence(s: string): YamlValue[] {
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  return splitFlowItems(inner).map(item => parseScalar(item.trim()));
}

function parseFlowMapping(s: string): Record<string, YamlValue> {
  const inner = s.slice(1, -1).trim();
  if (!inner) return {};
  const result: Record<string, YamlValue> = {};
  for (const item of splitFlowItems(inner)) {
    const colon = findColonIndex(item);
    if (colon === -1) continue;
    const key = item.slice(0, colon).trim();
    const val = item.slice(colon + 1).trim();
    result[key] = parseScalar(val);
  }
  return result;
}

/** Split "a, b, {c: d, e: f}, [1, 2]" by top-level commas */
function splitFlowItems(s: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
      else if (ch === ',' && depth === 0) {
        items.push(s.slice(start, i));
        start = i + 1;
      }
    }
  }
  if (start <= s.length) items.push(s.slice(start));
  return items.filter(i => i.trim() !== '');
}

/** Find the index of the first colon that is a key separator (not inside quotes/flow) */
function findColonIndex(s: string): number {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
      else if (ch === ':' && depth === 0 && (i + 1 >= s.length || s[i + 1] === ' ' || s[i + 1] === '\t' || s[i + 1] === '\n')) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Parse a block of lines starting at `startLine` with minimum indent `minIndent`.
 * Returns when it hits a line with lower indent (or EOF).
 */
function parseBlock(lines: string[], startLine: number, minIndent: number): ParseResult {
  // Detect whether this block is a sequence or mapping
  let i = startLine;

  // Skip blank/comment lines
  while (i < lines.length && isBlankOrComment(lines[i])) i++;

  if (i >= lines.length) return { value: null, nextLine: i };

  const firstIndent = getIndent(lines[i]);
  const firstContent = lines[i].trimStart();

  if (firstContent.startsWith('- ') || firstContent === '-') {
    // Block sequence
    return parseBlockSequence(lines, i, firstIndent);
  } else {
    // Block mapping
    return parseBlockMapping(lines, i, firstIndent);
  }
}

function parseBlockSequence(lines: string[], startLine: number, blockIndent: number): ParseResult {
  const items: YamlValue[] = [];
  let i = startLine;

  while (i < lines.length) {
    if (isBlankOrComment(lines[i])) { i++; continue; }
    const indent = getIndent(lines[i]);
    if (indent < blockIndent) break; // less indented — done
    if (indent > blockIndent) { i++; continue; } // shouldn't happen, skip

    const content = lines[i].trimStart();
    if (!content.startsWith('- ') && content !== '-') break; // not a sequence item

    const itemContent = content.startsWith('- ') ? content.slice(2).trimStart() : '';
    i++;

    if (itemContent === '' || itemContent === '|' || itemContent === '>') {
      // Nested block value on subsequent lines
      // Skip blank lines to find next indented block
      while (i < lines.length && isBlankOrComment(lines[i])) i++;
      if (i < lines.length && getIndent(lines[i]) > blockIndent) {
        const nested = parseBlock(lines, i, blockIndent + 1);
        items.push(nested.value);
        i = nested.nextLine;
      } else {
        items.push(null);
      }
    } else {
      // Inline value — check if next lines are indented (nested block)
      const colonIdx = findColonIndex(itemContent);
      if (colonIdx !== -1) {
        // This is a mapping item inline: "- key: val" — parse as mapping
        // Build virtual lines starting with the key part
        const keyPart = itemContent;
        // Gather continuation lines at deeper indent
        const nestedLines: string[] = [' '.repeat(blockIndent + 2) + keyPart];
        while (i < lines.length && !isBlankOrComment(lines[i]) && getIndent(lines[i]) > blockIndent) {
          nestedLines.push(lines[i]);
          i++;
        }
        // Also include blank lines if followed by deeper indent
        while (i < lines.length && isBlankOrComment(lines[i])) {
          const j = i + 1;
          if (j < lines.length && !isBlankOrComment(lines[j]) && getIndent(lines[j]) > blockIndent) {
            nestedLines.push(lines[i]);
            i++;
          } else break;
        }
        const mappingIndent = blockIndent + 2;
        const parsed = parseBlockMapping(nestedLines, 0, mappingIndent);
        items.push(parsed.value);
      } else {
        // Scalar item
        items.push(parseScalar(stripComment(itemContent)));
        // Check if next lines form a nested block (shouldn't for scalar, but handle)
      }
    }
  }

  return { value: items, nextLine: i };
}

function parseBlockMapping(lines: string[], startLine: number, blockIndent: number): ParseResult {
  const obj: Record<string, YamlValue> = {};
  let i = startLine;

  while (i < lines.length) {
    if (isBlankOrComment(lines[i])) { i++; continue; }
    const indent = getIndent(lines[i]);
    if (indent < blockIndent) break;
    if (indent > blockIndent) { i++; continue; } // unexpected deeper indent — skip

    const content = lines[i].trimStart();
    const colonIdx = findColonIndex(content);

    if (colonIdx === -1) {
      i++;
      continue; // not a mapping line
    }

    const key = content.slice(0, colonIdx).trim();
    const afterColon = content.slice(colonIdx + 1).trimStart();
    i++;

    if (afterColon === '' || afterColon === '|' || afterColon === '>') {
      // Value is on the next lines (nested block)
      // Skip blank lines to find the nested block
      while (i < lines.length && isBlankOrComment(lines[i])) i++;
      if (i < lines.length && getIndent(lines[i]) > blockIndent) {
        const nested = parseBlock(lines, i, blockIndent + 1);
        obj[key] = nested.value;
        i = nested.nextLine;
      } else {
        obj[key] = null;
      }
    } else {
      // Inline value
      const cleaned = stripComment(afterColon);
      const scalar = parseScalar(cleaned);

      // Check if the next lines are MORE indented — if so it's a nested block
      // (e.g. multi-line string or unexpected nesting — just use the scalar)
      if (typeof scalar === 'string' && scalar !== '' &&
          i < lines.length && !isBlankOrComment(lines[i]) && getIndent(lines[i]) > blockIndent) {
        // Probably shouldn't happen in valid config, but handle gracefully
        const nested = parseBlock(lines, i, blockIndent + 1);
        // If nested is a sequence, it means the scalar was wrong interpretation
        // For simple cases, prefer the inline scalar
        obj[key] = scalar;
        i = nested.nextLine;
      } else {
        obj[key] = scalar;
      }
    }
  }

  return { value: obj, nextLine: i };
}
