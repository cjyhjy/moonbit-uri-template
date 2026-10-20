import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expand } from '../sdk/index.mjs';

// Offline replay of the recorded Python reference comparison (tools/differential.py).
const { summary, cases } = JSON.parse(readFileSync(new URL('../testdata/differential/results.json', import.meta.url), 'utf8'));
const run = c => { try { return expand(c.template, c.variables); } catch (e) { return 'ERROR ' + e.code; } };

test('differential baseline still matches current output', () => {
  const drift = cases.filter(c => run(c) !== c.ours).map(c => c.name);
  assert.deepEqual(drift, []);
});
test('every disagreement with both references is an explained RFC choice', () => {
  const explained = new Set(['/t{;keys*}', '/%E4%B8%AD/中/{x}', '{+x:4}']);
  const both = cases.filter(c => c.agreement === 'differs_from_both').map(c => c.template);
  assert.deepEqual([...new Set(both)].filter(t => !explained.has(t)), []);
  assert.ok(summary.all_agree / cases.length > 0.9);
});
