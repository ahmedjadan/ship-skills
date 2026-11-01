// A deliberately small YAML subset, to keep the CLI dependency-free:
// maps, lists, lists of maps, scalars, quoted strings and inline [a, b] lists.
import { ShipError } from './util.mjs';

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === '\\' && quote === '"') i += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function scalar(raw) {
  const value = raw.trim();
  if (value === '' || value === '~' || value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      return JSON.parse(value);
    } catch {
      const inner = value.slice(1, -1).trim();
      return inner === '' ? [] : inner.split(',').map(scalar);
    }
  }
  return value;
}

function keyValue(text) {
  const match = text.match(/^("[^"]*"|'[^']*'|[^:]+?):(\s+(.*))?$/);
  return match ? { key: match[1].replace(/^["']|["']$/g, ''), rest: match[3] ?? '' } : null;
}

function parseBlock(lines, start, indent) {
  const isList = lines[start].text.startsWith('- ') || lines[start].text === '-';
  const out = isList ? [] : {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const { text, number } = lines[i];
    if (isList) {
      // A list may sit at its parent key's indent, so a non-item line ends it.
      if (!text.startsWith('-')) break;
      const inner = text.slice(1).trim();
      const pair = keyValue(inner);
      if (pair && !inner.startsWith('[') && !inner.startsWith('"')) {
        // A list item that opens a map: re-read it as a line at the item's inner indent.
        const innerIndent = indent + text.indexOf(inner);
        const nested = [{ indent: innerIndent, text: inner, number }];
        i += 1;
        while (i < lines.length && lines[i].indent >= innerIndent) nested.push(lines[(i += 1) - 1]);
        out.push(parseBlock(nested, 0, innerIndent)[0]);
      } else {
        out.push(scalar(inner));
        i += 1;
      }
    } else {
      const pair = keyValue(text);
      if (!pair) throw new ShipError('CONFIG_INVALID', `YAML line ${number}: expected "key: value"`);
      i += 1;
      const nestedList = i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('-');
      if (pair.rest === '' && i < lines.length && (lines[i].indent > indent || nestedList)) {
        const [value, next] = parseBlock(lines, i, lines[i].indent);
        out[pair.key] = value;
        i = next;
      } else {
        out[pair.key] = scalar(pair.rest);
      }
    }
  }
  if (i < lines.length && lines[i].indent > indent) {
    throw new ShipError('CONFIG_INVALID', `YAML line ${lines[i].number}: unexpected indent`);
  }
  return [out, i];
}

export function parseYaml(source) {
  const lines = source
    .split(/\r?\n/)
    .map((line, index) => {
      const clean = stripComment(line).trimEnd();
      return { indent: clean.length - clean.trimStart().length, text: clean.trim(), number: index + 1 };
    })
    .filter((line) => line.text !== '');
  if (lines.length === 0) return {};
  return parseBlock(lines, 0, lines[0].indent)[0];
}

export function parseFrontMatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: source };
  return { data: parseYaml(match[1]), body: match[2] };
}

// JSON strings and arrays are valid in the subset above, so writing is trivial.
export function stringifyFrontMatter(data, body) {
  const lines = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
