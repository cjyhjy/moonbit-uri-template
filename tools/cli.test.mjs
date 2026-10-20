import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request } from '../dist/engine.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, ['tools/cli.mjs', ...args], { cwd: root, encoding: 'utf8' });
test('analyze and compare expose complete structural changes with useful exit codes', () => {
  const analysis = cli('analyze', '😀/{x:3}{+x}', '--json');
  assert.equal(analysis.status, 0, analysis.stderr);
  const report = JSON.parse(JSON.parse(analysis.stdout).output);
  assert.equal(report.profiles[0].occurrences, 2);
  assert.equal(report.profiles[0].firstSpan.start, 3);
  const same = cli('compare', '/{x}', '/{x}', '--json');
  assert.equal(same.status, 0, same.stderr);
  assert.equal(JSON.parse(same.stdout).report.requiresReview, false);
  const changed = cli('compare', '/{x}', '/{+x:2}', '--json');
  assert.equal(changed.status, 1);
  assert.equal(changed.stderr, '');
  assert.equal(JSON.parse(changed.stdout).report.reservedAdded, true);
  assert.deepEqual(JSON.parse(changed.stdout).report.becameScalarOnly, ['x']);
  const invalid = cli('compare', '/{x}', '😀{x', '--json');
  assert.equal(invalid.status, 2);
  const error = JSON.parse(invalid.stderr).error;
  assert.equal(error.templateSide, 'after');
  assert.equal(error.start, 1);
  assert.equal(error.utf16Start, 2);
  assert.equal(cli('compare', '/{x}', '/{x}', '--json', '--json').status, 2);
});
for (const [name, args, expected] of [
  ['user query', ['expand', '/users/{id}{?page,limit}', '--vars-file', 'examples/users.json'], '/users/42?page=2&limit=20\n'],
  ['collection query', ['expand', '/search{?q,tags*}', '--vars-file', 'examples/search.json'], '/search?q=moon%20bit&tags=sdk&tags=api\n'],
  ['reserved and Unicode', ['expand', 'https://example.com{+path}{#fragment}', '--vars-file', 'examples/resource.json'], 'https://example.com/docs/%E4%B8%AD%E6%96%87#overview\n'],
  ['validation', ['validate', '{?x}'], 'valid\n'],
  ['ordered variables', ['variables', '{x,x}{?y,%61}'], '["x","y","%61"]\n'],
  ['empty template', ['expand', ''], '\n'],
  ['missing variable', ['expand', '/a{?x}'], '/a\n'],
  ['null and empty', ['expand', '{?a,b,c}', '--vars', '{"a":null,"b":"","c":[]}'], '?b=\n'],
  ['version', ['--version'], '0.2.0\n'],
]) test(name, () => {
  const result = cli(...args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, '');
});
for (const [name, args, code, error] of [
  ['unclosed expression', ['expand', '/users/{id'], 1, /UnclosedExpression.*1:8/],
  ['Unicode position', ['validate', '😀{x'], 1, /code points 1\.\.3/],
  ['composite prefix', ['expand', 'before/{x:1}', '--vars', '{"x":["a"]}'], 1, /PrefixOnComposite/],
  ['invalid JSON', ['expand', '{x}', '--vars', '{'], 2, /InvalidJson/],
  ['nested type', ['expand', '{x}', '--vars', '{"x":{"y":[]}}'], 2, /InvalidValueType.*\/x\/y/],
  ['JSON pointer', ['expand', '{x}', '--vars', '{"x":[null]}'], 2, /\/x\/0/],
  ['missing file', ['expand', '{x}', '--vars-file', 'examples/no-such-file.json'], 2, /FileError/],
  ['conflicting options', ['expand', '{x}', '--vars', '{}', '--vars-file', 'a'], 2, /InvalidArguments/],
  ['extra validate option', ['validate', '{x}', '--vars', '{}'], 2, /InvalidArguments/],
  ['missing option value', ['expand', '{x}', '--vars'], 2, /InvalidArguments/],
  ['missing template', ['expand'], 2, /InvalidArguments/],
  ['unknown command', ['unknown', '{x}'], 2, /InvalidArguments/],
]) test(name, () => {
  const result = cli(...args);
  assert.equal(result.status, code);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, error);
});
test('numbers and booleans expand as text', () => {
  const result = cli('expand', '/u/{id}{?on}', '--vars', '{"id":42,"on":true}');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '/u/42?on=true\n');
});
test('help', () => { assert.match(cli('--help').stdout, /RFC 6570/); });
test('foreign bridge uses public typed adapter', () => {
  assert.deepEqual(JSON.parse(request('expand', '{?x*}', '{"x":["a b","c"]}')), { exitCode: 0, output: '?x=a%20b&x=c' });
});

for (const [name, args, code, expected] of [
  ['compatibility literal quote', ['validate', "'{x}'"], 0, /valid/],
  ['strict literal quote rejected', ['validate', "'{x}'", '--strict'], 1, /InvalidLiteral/],
  ['strict encoded quote', ['validate', '%27{x}%27', '--strict'], 0, /valid/],
  ['strict expansion', ['expand', "'{x}'", '--strict'], 1, /InvalidLiteral/],
]) test(name, () => {
  const result = cli(...args);
  assert.equal(result.status, code);
  assert.match(code === 0 ? result.stdout : result.stderr, expected);
  assert.equal(code === 0 ? result.stderr : result.stdout, '');
});

import { request_with_options } from '../dist/engine.mjs';
import { locate } from './diagnostics.mjs';
const configured = (command, source, vars = {}, options = {}) => JSON.parse(request_with_options(command, source, JSON.stringify(vars), JSON.stringify(options)));
test('preflight distinguishes null empty and missing without leaking values', () => {
  const r = cli('check', '/{id}{?empty,present}', '--vars', '{"id":null,"empty":[],"present":"","extra":"SECRET"}', '--json');
  assert.equal(r.status, 1); assert.equal(r.stdout, '');
  const data = JSON.parse(r.stderr);
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.report.missing.map(i => i.name), ['id']);
  assert.deepEqual(data.report.omitted.map(i => i.name), ['empty']);
  assert.deepEqual(data.report.unused, ['extra']);
  assert.ok(!r.stderr.includes('SECRET'));
});
test('selective required preserves optional omission', () => {
  const r = cli('expand', '/{id}{?page}', '--vars', '{"id":"42"}', '--required', 'id', '--json');
  assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).output, '/42');
  assert.equal(configured('expand', '{x}', {x: []}, {requireAll: true}).error.code, 'OmittedBinding');
  assert.equal(configured('expand', '{x}', {x: ''}, {requireAll: true}).output, '');
  assert.equal(configured('expand', '{x}', {}, {required: ['typo']}).error.code, 'UnknownRequired');
});
for (const [flag, value, code] of [
  ['--max-template', '2', 'TemplateLimit'], ['--max-expressions', '0', 'ExpressionLimit'],
  ['--max-vars-per-expression', '0', 'VariableLimit'], ['--max-variables', '0', 'VariableLimit'],
  ['--max-output', '11', 'OutputLimit'], ['--max-bindings', '0', 'BindingLimit'],
  ['--max-members', '0', 'MemberLimit'], ['--max-value', '0', 'ValueLimit'],
  ['--max-total-value', '1', 'TotalValueLimit'], ['--max-json', '1', 'JsonInputLimit'],
  ['--max-json-depth', '1', 'JsonDepthLimit'],
]) test(`CLI budget ${flag}`, () => {
  const r = cli('expand', '{x}', '--vars', '{"x":["😀"]}', flag, value, '--json');
  assert.ok(r.status > 0); assert.equal(r.stdout, '');
  assert.equal(JSON.parse(r.stderr).error.code, code);
});
test('every bridge option rejects negative fractional huge and wrong-type values', () => {
  for (const key of ['maxTemplate','maxExpressions','maxVarsPerExpression','maxVariables','maxOutput','maxBindings','maxMembers','maxValue','maxTotalValue','maxJson','maxJsonDepth']) {
    for (const value of [-1, 0.5, 2147483648, '1', null, true]) {
      assert.equal(configured('expand', '', {}, {[key]:value}).error.code, 'InvalidOptions', `${key}: ${value}`);
    }
  }
  assert.equal(configured('expand', '', {}, {unknown: true}).error.code, 'InvalidOptions');
  assert.equal(configured('expand', '', {}, {required:[42]}).error.code, 'InvalidOptions');
});
test('JSON depth guard handles escaped quotes and brackets in strings', () => {
  const text = '" [ { \\ } ]';
  assert.equal(configured('expand', '{x}', {x:text}, {maxJsonDepth:1}).exitCode, 0);
  const deep = '{"x":' + '['.repeat(20000) + '"a"' + ']'.repeat(20000) + '}';
  const r = JSON.parse(request_with_options('expand', '{x}', deep, '{}'));
  assert.equal(r.error.code, 'JsonDepthLimit');
});
test('Unicode errors include code point and UTF16 editor offsets', () => {
  const r = cli('validate', '中😀{x', '--json');
  const e = JSON.parse(r.stderr).error;
  assert.equal(e.start, 2); assert.equal(e.utf16Start, 3);
  assert.equal(e.column, 3); assert.equal(e.line, 1);
  assert.equal(e.excerpt.lastIndexOf('{'), e.marker.indexOf('^'));
});
test('diagnostics clip long lines and escape terminal control codes', () => {
  const e = locate('a'.repeat(1000) + '\u001b{x', {code:'X', message:'test', start:1000, end:1001});
  assert.ok(e.excerpt.length < 100); assert.ok(!e.excerpt.includes('\u001b'));
  assert.equal(e.excerpt.indexOf('\\u{1b}'), e.marker.indexOf('^'));
  const multiline = locate('中\n😀{x', {start:3, end:5});
  assert.equal(multiline.line, 2); assert.equal(multiline.column, 2);
});
test('global input budget diagnostics do not fabricate a source range', () => {
  const r = configured('expand', '{x}', {secret:'DO_NOT_PRINT'}, {maxBindings:0});
  assert.equal(r.error.code, 'BindingLimit'); assert.ok(!('start' in r.error));
  assert.ok(!JSON.stringify(r).includes('DO_NOT_PRINT'));
});
test('file stdin is bounded and uses the same core', () => {
  const run = options => spawnSync(process.execPath, ['tools/cli.mjs', 'expand', '{x}', '--vars-file', '-', ...options], {cwd:root, encoding:'utf8', input:'{"x":"中文"}'});
  assert.equal(run([]).stdout, '%E4%B8%AD%E6%96%87\n');
  assert.match(run(['--max-json','1']).stderr, /JsonInputLimit/);
});
test('JSON remains machine readable for input errors and duplicate flags fail', () => {
  for (const args of [ ['--json','--max-output','-1'], ['--json','--max-output','1','--max-output','2'], ['--json','--required'] ]) {
    const r = cli('expand', '{x}', ...args);
    assert.equal(r.status, 2); assert.equal(JSON.parse(r.stderr).error.code, 'InvalidArguments');
  }
});
test('check clean report and reject-unused contract', () => {
  const clean = cli('check', '{x}', '--vars', '{"x":""}', '--json');
  assert.equal(clean.status, 0); assert.deepEqual(JSON.parse(clean.stdout).report.missing, []);
  const r = cli('expand', '{x}', '--vars', '{"x":"ok","extra":"SECRET"}', '--reject-unused', '--json');
  assert.equal(JSON.parse(r.stderr).error.code, 'UnusedBinding'); assert.ok(!r.stderr.includes('SECRET'));
});
