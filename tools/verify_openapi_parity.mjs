// Compare the migration against its immutable JS implementation and public report.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileOpenApi } from '../sdk/openapi.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), baseline = process.argv[2] ?? 'eeec975';
const git = path => execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const normalize = report => {
  const copy = structuredClone(report);
  for (const key of ['node', 'startedAt', 'finishedAt']) delete copy[key];
  for (const result of copy.results) delete result.elapsedMs;
  return copy;
};
const expected = JSON.parse(git('reports/openapi-public.json'));
const actual = JSON.parse(readFileSync(new URL('../reports/openapi-public.json', import.meta.url)));
assert.deepEqual(normalize(actual), normalize(expected));
const dir = mkdtempSync(join(tmpdir(), 'uri-openapi-parity-'));
let runtimeCases = 0;
try {
  const source = git('sdk/openapi.mjs').replace("'./index.mjs'", JSON.stringify(new URL('../sdk/index.mjs', import.meta.url).href));
  const path = join(dir, 'baseline.mjs'); writeFileSync(path, source);
  const baselineApi = await import(pathToFileURL(path));
  const doc = { openapi: '3.1.0', paths: {
    '/a/{id}': { get: { operationId: 'op', parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'q[x]', in: 'query' }, { name: 'Accept', in: 'header' },
      { name: 'deep', in: 'query', style: 'deepObject' },
    ] } }, '/missing/{x}': { get: { operationId: 'missing' } },
  } };
  const before = baselineApi.compileOpenApi(doc), after = compileOpenApi(doc);
  const values = [{}, null, [], 1, { id: 'a' }, { id: 'a', 'q[x]': undefined },
    { id: 'a', unknown: undefined }, { id: 'a', deep: undefined }, { id: 'a', deep: {} },
    { id: 'a', Accept: () => 1 }, { id: ['a'] }, { id: 'a', 'q[x]': { bad: { x: 1 } } },
    { id: 'a', 'q[x]': NaN }, { get id() { return 'a'; } },
    { id: 'a', 'q[x]': Object.defineProperty({}, 'x', { enumerable: true, get() { throw Error('getter ran'); } }) },
  ];
  const capture = (api, key, value) => {
    try { return api.expand(key, value); }
    catch (e) { return { name: e.name, message: e.message, ...e }; }
  };
  for (const key of ['op', 'missing', 'nope']) for (const value of values) {
    assert.deepEqual(capture(after, key, value), capture(before, key, value)); runtimeCases++;
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
const report = { status: 'passed', baseline, measuredAt: new Date().toISOString(),
  publicReport: 'Exact deep equality except node, startedAt, finishedAt and results[].elapsedMs',
  documents: actual.results.map(r => ({ name: r.name, operations: r.operations, templates: r.templates, examples: r.examples, diagnostics: r.diagnostics.length })),
  runtimeCases, runtimeComparison: 'Complete returned values or own error properties (excluding Error stack)',
};
writeFileSync(new URL('../reports/openapi-parity.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`Exact public corpus parity: passed (${report.documents.length} documents); runtime parity: ${runtimeCases}/${runtimeCases}`);
