import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request } from '../dist/engine.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, ['tools/cli.mjs', ...args], { cwd: root, encoding: 'utf8' });
for (const [name, args, expected] of [
  ['user query', ['expand', '/users/{id}{?page,limit}', '--vars-file', 'examples/users.json'], '/users/42?page=2&limit=20\n'],
  ['collection query', ['expand', '/search{?q,tags*}', '--vars-file', 'examples/search.json'], '/search?q=moon%20bit&tags=sdk&tags=api\n'],
  ['reserved and Unicode', ['expand', 'https://example.com{+path}{#fragment}', '--vars-file', 'examples/resource.json'], 'https://example.com/docs/%E4%B8%AD%E6%96%87#overview\n'],
  ['validation', ['validate', '{?x}'], 'valid\n'],
  ['ordered variables', ['variables', '{x,x}{?y,%61}'], '["x","y","%61"]\n'],
  ['empty template', ['expand', ''], '\n'],
  ['missing variable', ['expand', '/a{?x}'], '/a\n'],
  ['null and empty', ['expand', '{?a,b,c}', '--vars', '{"a":null,"b":"","c":[]}'], '?b=\n'],
  ['version', ['--version'], '0.1.1\n'],
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
  ['numeric type', ['expand', '{x}', '--vars', '{"x":42}'], 2, /InvalidValueType.*\/x/],
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
test('help', () => { assert.match(cli('--help').stdout, /RFC 6570/); });
test('foreign bridge uses public typed adapter', () => {
  assert.deepEqual(JSON.parse(request('expand', '{?x*}', '{"x":["a b","c"]}')), { exitCode: 0, output: '?x=a%20b&x=c' });
});

for (const [name, args, code, expected] of [
  ['compatibility literal quote', ['validate', "'{x}'"], 0, /valid/],
  ['strict literal quote rejected', ['validate', "'{x}'", '--strict'], 1, /InvalidLiteral/],
  ['strict encoded quote', ['validate', '%27{x}%27', '--strict'], 0, /valid/],
  ['strict cannot be misplaced', ['expand', '{x}', '--strict'], 2, /InvalidArguments/],
]) test(name, () => {
  const result = cli(...args);
  assert.equal(result.status, code);
  assert.match(code === 0 ? result.stdout : result.stderr, expected);
  assert.equal(code === 0 ? result.stderr : result.stdout, '');
});
