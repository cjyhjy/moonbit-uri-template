import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOpenApi, compileOpenApi, templateName } from './openapi.mjs';

const doc = (path, parameters, extra = {}) => ({ openapi: '3.1.0', paths: { [path]: { get: { operationId: 'op', parameters, ...extra } } } });
const p = (name, location, more = {}) => ({ name, in: location, ...(location === 'path' ? { required: true } : {}), schema: { type: 'string' }, ...more });
const only = d => analyzeOpenApi(d).operations[0];

test('names outside RFC 6570 varname syntax are percent-encoded', () => {
  assert.equal(templateName('per_page'), 'per_page');
  assert.equal(templateName('a.b'), 'a.b');
  assert.equal(templateName('filter[status]'), 'filter%5Bstatus%5D');
  assert.equal(templateName('user-id'), 'user%2Did');
  assert.equal(templateName('中'), '%E4%B8%AD');
  assert.equal(templateName('.a'), '%2Ea');
});

test('path styles map to RFC 6570 operators', () => {
  const op = only(doc('/a/{s}/{l}/{m}/{e}', [p('s', 'path'), p('l', 'path', { style: 'label' }), p('m', 'path', { style: 'matrix' }), p('e', 'path', { style: 'matrix', explode: true })]));
  assert.equal(op.template, '/a/{s}/{.l}/{;m}/{;e}');
  const list = only(doc('/a/{e}', [p('e', 'path', { style: 'matrix', explode: true, schema: { type: 'array' } })]));
  assert.equal(list.template, '/a/{;e*}');
});

test('form query parameters share one {?...} expression (Appendix C.1)', () => {
  const op = only(doc('/q', [p('foo', 'query', { schema: { type: 'object' } }), p('bar', 'query', { explode: false }), p('X-Trace', 'header'), p('sid', 'cookie')]));
  assert.equal(op.template, '/q{?foo*,bar}');
  assert.deepEqual(op.parameters.map(x => x.variable), ['foo', 'bar', null, null]);
});

test('Appendix C.4.1 example expands as the specification shows', () => {
  const api = compileOpenApi(doc('/math', [
    { name: 'formulas', in: 'query', schema: { type: 'object', additionalProperties: { type: 'string' } }, explode: true },
    { name: 'words', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
  ]));
  assert.equal(api.get('op').template, '/math{?formulas*,words*}');
  assert.equal(api.expand('op', { formulas: { a: 'x+y', b: 'x/y', c: 'x^y' } }), '/math?a=x%2By&b=x%2Fy&c=x%5Ey');
  // words has no explode field, so form style defaults it to true.
  assert.equal(api.expand('op', { words: ['math', 'is', 'fun'] }), '/math?words=math&words=is&words=fun');
});

test('styles without an RFC 6570 equivalent are listed, not guessed', () => {
  const op = only(doc('/q', [
    p('deep', 'query', { style: 'deepObject', schema: { type: 'object' } }),
    p('pipes', 'query', { style: 'pipeDelimited', schema: { type: 'array' } }),
    p('spaces', 'query', { style: 'spaceDelimited', schema: { type: 'array' } }),
    p('raw', 'query', { allowReserved: true }),
    { name: 'json', in: 'query', content: { 'application/json': {} } },
    p('ok', 'query'),
  ]));
  assert.equal(op.template, '/q{?ok}');
  assert.deepEqual(op.unsupported.map(u => u.name), ['deep', 'pipes', 'spaces', 'raw', 'json']);
  const path = only(doc('/a/{id}', [p('id', 'path', { style: 'form' })]));
  assert.equal(path.template, null);
});

test('query names that collide with a path variable are not merged, in either order', () => {
  for (const params of [[p('id', 'path'), p('id', 'query')], [p('id', 'query'), p('id', 'path')]]) {
    const op = only(doc('/a/{id}', params));
    assert.equal(op.template, '/a/{id}');
    assert.equal(op.unsupported[0].reason, 'name is also used by a path parameter');
  }
});

test('a declared path parameter missing from the path does not block expansion', () => {
  const api = compileOpenApi(doc('/a', [p('ghost', 'path'), p('q', 'query')]));
  assert.equal(api.diagnostics[0].code, 'UnusedPathParameter');
  assert.equal(api.expand('op', { q: 'x' }), '/a?q=x');
  assert.throws(() => { api.get('op').parameters.push({}); }, TypeError);
});

test('examples build a URI and mismatches are warnings that keep ok', () => {
  const r = analyzeOpenApi(doc('/r/{owner}', [
    p('owner', 'path', { example: 'octo cat' }),
    p('tags', 'query', { schema: { type: 'array', items: { type: 'string' } }, example: ['a', 'b'] }),
    p('page', 'query', { schema: { type: 'integer', example: 2 } }),
  ]));
  assert.equal(r.ok, true);
  assert.equal(r.operations[0].example, '/r/octo%20cat?tags=a&tags=b&page=2');
  const bad = analyzeOpenApi(doc('/r', [
    p('owner', 'query', { schema: { type: 'array', items: { type: 'string' }, example: 'owner[]=a,owner[]=b' } }),
    p('deep', 'query', { schema: { type: 'object' }, example: { a: { b: 'c' } } }),
  ]));
  assert.equal(bad.ok, true);
  assert.deepEqual(bad.diagnostics.map(d => [d.severity, d.code, d.path]), [
    ['warning', 'ExampleShapeMismatch', '/paths/~1r/get/parameters/0/schema/example'],
    ['warning', 'ExampleNotSerializable', '/paths/~1r/get/parameters/1/example'],
  ]);
});

test('a shared parameter reports its example once, at the component', () => {
  const d = { openapi: '3.0.3', components: { parameters: { tags: { name: 'tags', in: 'query', schema: { type: 'array' }, example: 'x' } } }, paths: {} };
  for (let i = 0; i < 3; i++) d.paths[`/p${i}`] = { get: { parameters: [{ $ref: '#/components/parameters/tags' }] } };
  const r = analyzeOpenApi(d);
  assert.deepEqual(r.diagnostics.map(x => x.path), ['/components/parameters/tags/example']);
});

test('warnings beyond the cap are counted without making the report incomplete', () => {
  const d = { openapi: '3.1.0', paths: {} };
  for (let i = 0; i < 300; i++) d.paths[`/p${i}`] = { get: { parameters: [p('t', 'query', { schema: { type: 'array' }, example: 'x' })] } };
  const r = analyzeOpenApi(d);
  assert.equal(r.complete, true);
  assert.equal(r.diagnostics.length, 256);
  assert.equal(r.truncated.warnings, 44);
});

test('operationId must be unique', () => {
  const d = { openapi: '3.1.0', paths: { '/a': { get: { operationId: 'x' } }, '/b': { get: { operationId: 'x' } } } };
  assert.deepEqual(analyzeOpenApi(d).diagnostics.map(x => x.code), ['DuplicateOperationId']);
});

test('compileOpenApi expands by operationId or method and path', () => {
  const spec = { openapi: '3.1.0', paths: { '/repos/{owner}/{repo}/commits': { parameters: [p('owner', 'path'), p('repo', 'path')],
    get: { operationId: 'repos/list-commits', parameters: [p('per_page', 'query', { schema: { type: 'integer' } }), p('filter[since]', 'query'), p('Accept', 'header')] } } } };
  const api = compileOpenApi(JSON.stringify(spec), { baseUrl: 'https://api.github.com/' });
  const vars = { owner: 'octo', repo: 'hello world', per_page: 10, 'filter[since]': '2026-01-01', Accept: 'application/json' };
  assert.equal(api.expand('repos/list-commits', vars), 'https://api.github.com/repos/octo/hello%20world/commits?per_page=10&filter%5Bsince%5D=2026-01-01');
  assert.equal(api.expand('GET /repos/{owner}/{repo}/commits', { owner: 'a', repo: 'b' }), 'https://api.github.com/repos/a/b/commits');
  assert.equal(api.operations.length, 1);
  assert.throws(() => api.expand('repos/list-commits', { owner: 'a' }), { code: 'MissingBinding' });
  assert.throws(() => api.expand('repos/list-commits', { owner: 'a', repo: 'b', perpage: 1 }), { code: 'UnknownParameter' });
  assert.throws(() => api.expand('repos/list-commits', { owner: ['a'], repo: 'b' }), { code: 'BindingType' });
  assert.throws(() => api.expand('nope', {}), { code: 'UnknownOperation' });
});

test('unsupported parameters and operations fail with the reason', () => {
  const api = compileOpenApi(doc('/q', [p('deep', 'query', { style: 'deepObject' })]));
  assert.equal(api.expand('op', {}), '/q');
  assert.throws(() => api.expand('op', { deep: { a: '1' } }), { code: 'UnsupportedParameter', message: /deepObject/ });
  const none = compileOpenApi(doc('/a/{id}', [p('id', 'path', { style: 'form' })]));
  assert.throws(() => none.expand('op', { id: '1' }), { code: 'UnsupportedOperation' });
});

test('strict mode rejects errors; incomplete documents always throw', () => {
  const d = { openapi: '3.1.0', paths: { '/a/{x}': { get: {} } } };
  assert.equal(compileOpenApi(d).diagnostics[0].code, 'MissingPathParameter');
  assert.throws(() => compileOpenApi(d, { strict: true }), e => e.code === 'OpenApiInvalid' && e.diagnostics.length === 1);
  assert.throws(() => compileOpenApi({ openapi: '2.0' }), { code: 'OpenApiInvalid' });
  assert.throws(() => compileOpenApi('{'), { code: 'InvalidJson' });
});
