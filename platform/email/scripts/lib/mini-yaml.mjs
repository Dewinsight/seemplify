/**
 * A deliberately small YAML reader for the Compose files in this directory.
 *
 * The Mail API ships with no dependencies and the operational scripts inherit
 * that rule, so the compose checks either parse the file themselves or degrade
 * into regular expressions over YAML — which is how a check ends up asserting
 * that a string is present rather than that a service is configured.
 *
 * It covers exactly the subset these files use: block mappings and sequences,
 * flow sequences and mappings, quoted and bare scalars, anchors, aliases and
 * merge keys. Anything outside that subset raises rather than guessing, so a
 * future compose feature fails the check loudly instead of being silently
 * misread.
 */

const MERGE_KEY = '<<';

class YamlError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'YamlError';
    this.line = line ?? null;
  }
}

/** Strips a document into indented, comment-free, non-empty lines. */
function scan(text) {
  const lines = [];
  const raw = String(text).split(/\r?\n/);
  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (line.trim() === '---') continue;
    if (/^\t/.test(line)) throw new YamlError('Tabs are not valid YAML indentation.', index + 1);
    lines.push({ indent: line.length - line.trimStart().length, content: line.trim(), lineNo: index + 1 });
  }
  return lines;
}

/**
 * Finds the colon that separates a mapping key from its value: the first one
 * outside quotes that is followed by a space or ends the line. `image:
 * ghcr.io/x:1.2` and `- 0.0.0.0:2000` therefore stay scalars, which is what
 * YAML itself does.
 */
function splitKey(content) {
  let quote = null;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char !== ':') continue;
    const next = content[index + 1];
    if (next === undefined || next === ' ') {
      return { key: content.slice(0, index).trim(), value: content.slice(index + 1).trim() };
    }
  }
  return null;
}

function unquote(token) {
  if (token.length >= 2 && token[0] === '"' && token.at(-1) === '"') {
    return token.slice(1, -1).replace(/\\(["\\/nrt])/g, (_, char) => ({ n: '\n', r: '\r', t: '\t' })[char] ?? char);
  }
  if (token.length >= 2 && token[0] === "'" && token.at(-1) === "'") {
    return token.slice(1, -1).replace(/''/g, "'");
  }
  return token;
}

/** Bare scalars keep YAML's plain-scalar typing; everything quoted stays text. */
function coerce(token) {
  if (token !== unquote(token) || /^["']/.test(token)) return unquote(token);
  if (token === '' || token === '~' || token === 'null') return null;
  if (token === 'true' || token === 'false') return token === 'true';
  if (/^-?\d+$/.test(token)) return Number.parseInt(token, 10);
  if (/^-?\d*\.\d+$/.test(token)) return Number.parseFloat(token);
  return token;
}

function parseFlow(source, line) {
  let index = 0;

  function skipSpace() {
    while (index < source.length && /\s/.test(source[index])) index += 1;
  }

  function readToken() {
    const start = index;
    let quote = null;
    while (index < source.length) {
      const char = source[index];
      if (quote) {
        if (char === '\\' && quote === '"') index += 1;
        else if (char === quote) quote = null;
        index += 1;
        continue;
      }
      if (char === '"' || char === "'") { quote = char; index += 1; continue; }
      if (char === ',' || char === ']' || char === '}' || char === ':') break;
      index += 1;
    }
    return source.slice(start, index).trim();
  }

  function readValue() {
    skipSpace();
    const char = source[index];
    if (char === '[') return readSequence();
    if (char === '{') return readMapping();
    return coerce(readToken());
  }

  function readSequence() {
    index += 1; // [
    const items = [];
    skipSpace();
    if (source[index] === ']') { index += 1; return items; }
    for (;;) {
      items.push(readValue());
      skipSpace();
      if (source[index] === ',') { index += 1; continue; }
      if (source[index] === ']') { index += 1; return items; }
      throw new YamlError('Malformed flow sequence.', line);
    }
  }

  function readMapping() {
    index += 1; // {
    const map = {};
    skipSpace();
    if (source[index] === '}') { index += 1; return map; }
    for (;;) {
      skipSpace();
      const key = unquote(readToken());
      skipSpace();
      if (source[index] !== ':') throw new YamlError('Malformed flow mapping.', line);
      index += 1;
      map[key] = readValue();
      skipSpace();
      if (source[index] === ',') { index += 1; continue; }
      if (source[index] === '}') { index += 1; return map; }
      throw new YamlError('Malformed flow mapping.', line);
    }
  }

  const value = readValue();
  skipSpace();
  if (index !== source.length) throw new YamlError('Trailing characters after a flow collection.', line);
  return value;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

export function parseYaml(text) {
  const lines = scan(text);
  const anchors = new Map();
  let cursor = 0;

  function resolveAlias(token, line) {
    const name = token.slice(1).trim();
    if (!anchors.has(name)) throw new YamlError(`Unknown anchor: *${name}`, line);
    return clone(anchors.get(name));
  }

  /** Parses whatever follows a `key:` or `- ` that had no inline value. */
  function parseNested(indent) {
    if (cursor >= lines.length || lines[cursor].indent <= indent) return null;
    return parseNode(lines[cursor].indent);
  }

  function parseScalarOrRef(token, indent, line) {
    if (token.startsWith('&')) {
      const [, name, rest = ''] = token.match(/^&(\S+)\s*([\s\S]*)$/) ?? [];
      if (!name) throw new YamlError('Malformed anchor.', line);
      const value = rest ? parseScalarOrRef(rest, indent, line) : parseNested(indent);
      anchors.set(name, value);
      return value;
    }
    if (token.startsWith('*')) return resolveAlias(token, line);
    if (token.startsWith('[') || token.startsWith('{')) return parseFlow(token, line);
    return coerce(token);
  }

  function parseNode(indent) {
    if (cursor >= lines.length) return null;
    return lines[cursor].content.startsWith('- ') || lines[cursor].content === '-'
      ? parseSequence(indent)
      : parseMapping(indent);
  }

  function parseSequence(indent) {
    const items = [];
    while (cursor < lines.length && lines[cursor].indent === indent) {
      const { content, lineNo } = lines[cursor];
      if (!content.startsWith('- ') && content !== '-') break;
      const rest = content === '-' ? '' : content.slice(2).trim();
      cursor += 1;
      if (rest === '') {
        items.push(parseNested(indent));
        continue;
      }
      // `- key: value` opens a mapping whose remaining keys align past the
      // dash. Rewriting the dash line to that alignment lets the ordinary
      // mapping parser consume the whole item.
      if (splitKey(rest) && !rest.startsWith('[') && !rest.startsWith('{')) {
        cursor -= 1;
        lines[cursor] = { indent: indent + 2, content: rest, lineNo };
        items.push(parseMapping(indent + 2));
        continue;
      }
      items.push(parseScalarOrRef(rest, indent, lineNo));
    }
    return items;
  }

  function parseMapping(indent) {
    const map = {};
    while (cursor < lines.length && lines[cursor].indent === indent) {
      const { content, lineNo } = lines[cursor];
      if (content.startsWith('- ')) break;
      const parts = splitKey(content);
      if (!parts) throw new YamlError(`Expected a mapping entry: ${content}`, lineNo);
      cursor += 1;
      const key = unquote(parts.key);
      const value = parts.value === '' ? parseNested(indent) : parseScalarOrRef(parts.value, indent, lineNo);
      if (key === MERGE_KEY) {
        for (const source of Array.isArray(value) ? value : [value]) {
          if (!source || typeof source !== 'object') throw new YamlError('A merge key needs a mapping.', lineNo);
          // Explicit keys win over merged ones, as YAML requires.
          for (const [mergedKey, mergedValue] of Object.entries(source)) {
            if (!(mergedKey in map)) map[mergedKey] = mergedValue;
          }
        }
        continue;
      }
      map[key] = value;
    }
    return map;
  }

  const document = lines.length ? parseNode(lines[0].indent) : null;
  if (cursor !== lines.length) throw new YamlError('Unconsumed content; indentation is inconsistent.', lines[cursor]?.lineNo);
  return document;
}

export { YamlError };
