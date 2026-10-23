// JSON source positions, including escaped strings. URI semantics stay in MoonBit.
export function parseSource(text, maxDepth = 32) {
  let quoted = false, escaped = false, depth = 0;
  for (const c of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') {
      if (++depth > maxDepth) throw Object.assign(new Error('JSON nesting exceeds budget'), { code: 'JsonDepthLimit' });
    } else if (c === '}' || c === ']') depth--;
  }
  // Validate grammar before traversing tokens; never expose input values in errors.
  try { JSON.parse(text); } catch { throw Object.assign(new Error('invalid JSON document'), { code: 'InvalidJson' }); }
  const nodes = new Map(), keys = new Map();
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  function string() {
    const start = i++, offsets = [];
    while (text[i] !== '"') {
      const begin = i;
      if (text[i] === '\\') {
        i += text[i + 1] === 'u' ? 6 : 2;
      } else i++;
      offsets.push(begin);
    }
    const end = ++i;
    offsets.push(end - 1);
    return { value: JSON.parse(text.slice(start, end)), start, end, offsets };
  }
  const pointer = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
  function value(path) {
    ws();
    const start = i;
    let result;
    if (text[i] === '"') {
      const token = string();
      nodes.set(path, token);
      return token.value;
    }
    if (text[i] === '{') {
      i++; ws(); result = Object.create(null);
      const seen = new Set();
      while (text[i] !== '}') {
        const key = string(); ws(); i++;
        const child = path + '/' + pointer(key.value);
        if (seen.has(key.value)) throw Object.assign(new Error('duplicate JSON key'), { code: 'DuplicateJsonKey', path: child, start: key.start, end: key.end });
        seen.add(key.value);
        keys.set(child, key);
        result[key.value] = value(child); ws();
        if (text[i] !== ',') break;
        i++; ws();
      }
      i++;
    } else if (text[i] === '[') {
      i++; ws(); result = [];
      while (text[i] !== ']') {
        result.push(value(path + '/' + result.length)); ws();
        if (text[i] !== ',') break;
        i++; ws();
      }
      i++;
    } else {
      while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
      result = JSON.parse(text.slice(start, i));
    }
    nodes.set(path, { start, end: i });
    return result;
  }
  return { value: value(''), nodes, keys };
}

export function filePosition(text, offset) {
  const prefix = text.slice(0, offset);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}
