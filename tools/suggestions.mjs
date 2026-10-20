// A bounded, conservative suggestion: one edit or one adjacent transposition.
// Never rewrites user data; ambiguous or already-bound targets are excluded.
export function suggestBinding(name, candidates) {
  if (typeof name !== 'string' || name.length > 64 || candidates.length > 256) return undefined;
  const a = Array.from(name), matches = [];
  for (const candidate of candidates) {
    if (candidate === name || candidate.length > 64) continue;
    const b = Array.from(candidate);
    if (Math.abs(a.length - b.length) > 1) continue;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    const same = (x, y) => a.slice(x).join('') === b.slice(y).join('');
    const near = a.length === b.length
      ? same(i + 1, i + 1) ||
        (a[i] === b[i + 1] && a[i + 1] === b[i] && same(i + 2, i + 2))
      : a.length > b.length ? same(i + 1, i) : same(i, i + 1);
    if (near) matches.push(candidate);
    if (matches.length > 1) return undefined;
  }
  return matches[0];
}
