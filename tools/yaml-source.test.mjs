import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkOpenAPI} from './openapi.mjs';
import {parseYamlSource} from './yaml-source.mjs';

const yaml = `openapi: 3.1.0
info: {title: YAML example, version: '1'}
paths:
  /pets/{id}:
    get:
      operationId: pets/get
      parameters:
        - {name: id, in: path, required: true, schema: {type: string}}
        - {name: tags, in: query, schema: {type: array, items: {type: string}}}
`;
const check = (text, options) => checkOpenAPI(text, 'spec.yaml', options);

test('YAML and JSON use the same OpenAPI core and keep operation semantics', () => {
  const json = JSON.stringify(parseYamlSource(yaml).value);
  const a = check(yaml), b = checkOpenAPI(json);
  assert.equal(a.ok, true); assert.deepEqual(a.operations, b.operations);
  assert.equal(a.operations[0].template, '/pets/{id}{?tags*}');
  assert.match(a.scope, /YAML 1.2/);
  assert.equal(checkOpenAPI(yaml, 'spec.json').diagnostics[0].code, 'InvalidJson');
  assert.equal(checkOpenAPI(yaml, 'no-extension', {format:'yaml'}).ok, true);
});
test('YAML diagnostics use original line and column including pointer escapes', () => {
  const text = 'openapi: 3.1.0\npaths:\n  /pets/{id}:\n    get: {}\n';
  const d = check(text).diagnostics[0];
  assert.equal(d.code, 'MissingPathParameter');
  assert.equal(d.path, '/paths/~1pets~1{id}/get');
  assert.deepEqual([d.line,d.column], [4,10]);
  const invalid = 'openapi: 3.1.0\n"\\ud800": true\npaths: {}\n';
  const s = check(invalid).diagnostics[0];
  assert.equal(s.code,'InvalidInput'); assert.deepEqual([s.line,s.column],[2,1]);
});
test('YAML references and bounded aliases retain source pointers', () => {
  const text = `openapi: 3.1.0
components:
  parameters:
    id: &id {name: id, in: path, required: true}
paths:
  /pets/{id}:
    get:
      parameters: [*id]
`;
  assert.equal(check(text).ok,true);
  assert.equal(check(text.replace('parameters: [*id]', "parameters: [{$ref: '#/components/parameters/id'}]")).ok,true);
  const bad = check(text.replace('required: true','required: false'));
  assert.equal(bad.diagnostics[0].code,'PathParameterRequired');
  assert.equal(bad.diagnostics[0].line,8);
});
test('YAML rejects ambiguous or non-JSON inputs without accepting partial documents', () => {
  for (const [text, code] of [
    ['openapi: 3.1.0\npaths: {}\npaths: {}','DuplicateYamlKey'],
    ['openapi: 3.1.0\npaths: {}\n---\npaths: {}','InvalidYaml'],
    ['openapi: 3.1.0\nx: !unknown hi\npaths: {}','InvalidYaml'],
    ['openapi: 3.1.0\nx: .inf\npaths: {}','InvalidYaml'],
    ['%YAML 1.1\n---\nopenapi: 3.1.0\npaths: {}','UnsupportedYaml'],
    ['openapi: 3.1.0\nx: &x [*x]\npaths: {}','YamlAliasCycle'],
    ['openapi: 3.1.0\nx: *missing\npaths: {}','InvalidYaml'],
    ['openapi: 3.1.0\nx: &x {a: true}\ny: {<<: *x}\npaths: {}','UnsupportedYaml'],
  ]) {const r=check(text); assert.equal(r.complete,false,text); assert.equal(r.diagnostics[0].code,code,text);}
});
test('YAML budgets cover depth, alias expansion and expanded bytes', () => {
  assert.equal(check('x: ' + '['.repeat(130) + '0' + ']'.repeat(130)).diagnostics[0].code,'YamlDepthLimit');
  assert.equal(check('x: &a foo\ny: [' + Array(101).fill('*a').join(',') + ']').diagnostics[0].code,'YamlAliasLimit');
  const text = 'x: &a ' + 'a'.repeat(1000) + '\ny: [' + Array(30).fill('*a').join(',') + ']';
  assert.equal(check(text, {maxBytes:2000}).diagnostics[0].code,'OpenAPIInputLimit');
});
test('YAML objects preserve prototype-like keys and scalar string types', () => {
  const v = parseYamlSource('openapi: 3.1.0\npaths: {}\n__proto__: {polluted: true}\nx: no\nresponses: {200: {}}').value;
  assert.equal(v.x,'no'); assert.equal(v.__proto__.polluted,true); assert.equal({}.polluted,undefined);
  assert.ok(Object.hasOwn(v.responses,'200'));
});
test('installed-shape YAML CLI preserves exit codes 0, 1 and 2 and format override', () => {
  const dir = mkdtempSync(join(tmpdir(),'uri-yaml-'));
  try {
    const file = join(dir,'spec.yaml');
    for (const [text, status] of [[yaml,0],[yaml.replace('name: id','name: other'),1],['x: [',2]]) {
      writeFileSync(file,text);
      const r = spawnSync(process.execPath,['tools/cli.mjs','openapi',file,'--json'],{encoding:'utf8'});
      assert.equal(r.status,status,r.stderr); assert.equal(JSON.parse(r.stdout || r.stderr).exitCode,status);
    }
    writeFileSync(file,yaml);
    const forced = spawnSync(process.execPath,['tools/cli.mjs','openapi',file,'--format','json','--json'],{encoding:'utf8'});
    assert.equal(forced.status,2); assert.equal(JSON.parse(forced.stderr).diagnostics[0].code,'InvalidJson');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
