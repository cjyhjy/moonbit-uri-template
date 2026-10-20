// Shared presentation only; parsing and expansion always run in MoonBit.
export function locate(source, error) {
  if (!Number.isInteger(error.start)) return error;
  const chars = Array.from(source);
  const start = Math.max(0, Math.min(error.start, chars.length));
  const end = Math.max(start, Math.min(error.end, chars.length));
  const position = offset => {
    let line = 1, column = 1;
    for (let i = 0; i < offset; i++) {
      if (chars[i] === '\n') { line++; column = 1; } else column++;
    }
    return { line, column };
  };
  const begin = position(start), finish = position(end);
  // Escape controls AND non-ASCII to make terminal caret columns deterministic.
  const display = c => /^[\x20-\x7e]$/.test(c) ? c : `\\u{${c.codePointAt(0).toString(16)}}`;
  let left = start, right = start;
  while (left > 0 && chars[left - 1] !== '\n' && start - left < 32) left--;
  while (right < chars.length && chars[right] !== '\n' && right - left < 64) right++;
  const prefix = left > 0 && chars[left - 1] !== '\n' ? '…' : '';
  const suffix = right < chars.length && chars[right] !== '\n' ? '…' : '';
  const excerpt = prefix + chars.slice(left, right).map(display).join('') + suffix;
  const indent = prefix.length + chars.slice(left, start).map(display).join('').length;
  const width = Math.max(1, chars.slice(start, Math.min(end, right)).map(display).join('').length);
  return { ...error, offsetUnit: 'unicode-code-point', ...begin,
    endLine: finish.line, endColumn: finish.column,
    utf16Start: chars.slice(0, start).join('').length,
    utf16End: chars.slice(0, end).join('').length,
    excerpt, marker: ' '.repeat(indent) + '^'.repeat(width) };
}
export function humanDiagnostic(error) {
  const where = 'start' in error
    ? ` at ${error.line}:${error.column} (code points ${error.start}..${error.end})`
    : 'path' in error ? ` at JSON Pointer ${JSON.stringify(error.path)}` : '';
  const header = `${error.code}${where}: ${error.message}`.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, c => `\\u{${c.codePointAt(0).toString(16)}}`);
  return error.excerpt !== undefined ? `${header}\n  ${error.excerpt}\n  ${error.marker}\n` : `${header}\n`;
}
