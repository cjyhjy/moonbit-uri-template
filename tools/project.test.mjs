import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { checkProject, githubAnnotation } from './project.mjs';
import { suggestBinding } from './suggestions.mjs';
const doc = () => ({ schemaVersion: 1, templates: [{ name: 'users', template: '/users/{id}{?tags*}', required: ['id'], types: { id: 'scalar', tags: 'list' } }],
  requests: [{ template: 'users', variables: { id: '42' } }] });
const check = x => checkProject(JSON.stringify(x, null, 2));

test('project allows omitted optional query and exposes source origins', () => {
  const r = check(doc());
  assert.equal(r.ok, true); assert.equal(r.outputs[0].uri, '/users/42');
  assert.equal(r.totalOutputBytes, 9); assert.equal(r.outputs[0].origins[1].name, 'id');
  const measured = checkProject(JSON.stringify(doc()), 'config.json', { materialize: false });
  assert.equal(measured.ok, true);
  assert.equal(measured.totalOutputBytes, r.totalOutputBytes);
  assert.deepEqual(measured.outputs, []);
});
test('actionable typo suggests a unique unbound target without rewriting data', () => {
  const d = doc(); d.requests[0].variables = { id: '42', tgas: ['x'] };
  const r = check(d), issue = r.diagnostics.find(x => x.code === 'UnusedBinding');
  assert.equal(r.ok, false); assert.deepEqual(r.outputs, []);
  assert.deepEqual(issue.suggestion, { kind: 'rename-binding', from: '/requests/0/variables/tgas', to: '/requests/0/variables/tags' });
  assert.match(issue.message, /did you mean "tags"/);
  assert.deepEqual(d.requests[0].variables, { id: '42', tgas: ['x'] });
  d.requests[0].variables.tags = ['already present'];
  assert.equal(check(d).diagnostics.find(x => x.code === 'UnusedBinding').suggestion, undefined);
  assert.equal(suggestBinding('cat', ['bat', 'car']), undefined);
  assert.equal(suggestBinding('owenr', ['owner']), 'owner');
  assert.equal(suggestBinding('repo', ['repository']), undefined);
  assert.equal(suggestBinding('x'.repeat(65), ['x'.repeat(64)]), undefined);
});
test('project blocks missing unused empty required and incompatible types', () => {
  const d = doc(); d.requests[0].variables = { ID: '42' };
  assert.deepEqual(check(d).diagnostics.map(x => x.code), ['MissingBinding', 'UnusedBinding']);
  d.requests[0].variables = { id: [] };
  assert.deepEqual(check(d).diagnostics.map(x => x.code), ['BindingType', 'OmittedBinding']);
  assert.deepEqual(check(d).outputs, []);
});
test('file positions track JSON escapes and surrogate pairs', () => {
  const d = doc(); d.templates[0].template = '😀/{id}'; d.requests[0].variables = {};
  const text = JSON.stringify(d, null, 2).replace('😀', '\\ud83d\\ude00');
  const r = checkProject(text);
  const error = r.diagnostics.find(x => x.code === 'MissingBinding');
  const line = text.split('\n')[error.line - 1];
  assert.equal(line.slice(error.column - 1, error.endColumn - 1), 'id');
  assert.equal(error.templateLocation.start, 3);
  assert.equal(error.templateLocation.utf16Start, 4);
});
test('reject duplicate keys including escaped spellings and excessive depth', () => {
  assert.equal(checkProject('{"schemaVersion":1,"schema\\u0056ersion":1}').diagnostics[0].code, 'DuplicateJsonKey');
  assert.equal(checkProject('{"x":0,"x":1}').diagnostics[0].code, 'DuplicateJsonKey');
  assert.equal(checkProject('['.repeat(33) + ']'.repeat(33)).diagnostics[0].code, 'JsonDepthLimit');
});
test('aggregate output and input budgets are atomic and boundary-inclusive', () => {
  const d = doc(); d.requests.push(structuredClone(d.requests[0])); d.maxTotalOutputBytes = 18;
  assert.equal(check(d).ok, true);
  d.maxTotalOutputBytes = 17;
  assert.equal(check(d).diagnostics[0].code, 'ProjectOutputLimit'); assert.deepEqual(check(d).outputs, []);
  d.maxTotalOutputBytes = 18; d.maxTotalInputCodepoints = 0;
  assert.equal(check(d).diagnostics[0].code, 'ProjectInputLimit');
});
test('schema typos catalog duplicates unknown names and invalid limits fail closed', () => {
  const d = doc(); d.templates[0].require = ['id'];
  assert.equal(check(d).diagnostics[0].code, 'UnknownField'); delete d.templates[0].require;
  d.templates.push(structuredClone(d.templates[0]));
  assert.equal(check(d).diagnostics[0].code, 'CatalogName'); d.templates.pop();
  d.templates[0].required = ['typo'];
  assert.equal(check(d).diagnostics[0].code, 'UnknownRequired');
  d.maxTotalOutputBytes = -1;
  assert.equal(check(d).diagnostics[0].code, 'InvalidLimit');
});
test('diagnostics have a hard cap and direct API input obeys file budget', () => {
  const d = doc();
  d.requests = Array.from({ length: 256 }, () => ({ template: 'users', variables: { ID: '42' } }));
  const result = check(d);
  assert.equal(result.diagnostics.length, 256);
  assert.equal(result.diagnostics.at(-1).code, 'DiagnosticLimit');
  assert.equal(checkProject(' '.repeat(1048577)).diagnostics[0].code, 'ProjectInputLimit');
  const nullRequired = doc(); nullRequired.templates[0].required = null;
  assert.equal(check(nullRequired).diagnostics[0].code, 'InvalidRequired');
});
test('annotation metadata and message escape control characters', () => {
  const annotation = githubAnnotation({ file: 'a,b:c\nx', line: 2, column: 3, endLine: 2, endColumn: 4, code: 'Error', message: 'x\n::warning::fake%' });
  assert.equal(annotation, '::error file=a%2Cb%3Ac%0Ax,line=2,col=3,endLine=2,endColumn=4::Error: x%0A::warning::fake%25');
});
test('measure trace CLI honor required and exact output budget', () => {
  const run = (...args) => spawnSync(process.execPath, ['tools/cli.mjs', ...args], { encoding: 'utf8' });
  assert.equal(run('measure', '{x}', '--vars', '{"x":"😀"}').stdout.trim(), '12');
  assert.equal(run('measure', '{x}', '--vars', '{"x":"😀"}', '--max-output', '11').status, 1);
  assert.equal(run('trace', '{x}', '--required', 'x').status, 1);
  assert.equal(JSON.parse(run('trace', '{x}', '--vars', '{"x":"a"}').stdout).uri, 'a');
});
