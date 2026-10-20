import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, expand, UriTemplateError } from './index.mjs';

test('compiled SDK preserves required contract and reusable immutable options', () => {
  const options = { required: ['id'], requireAll: false };
  const t = compileTemplate('/users/{id}{?tags*}', options);
  options.required.push('tags');
  assert.deepEqual(t.variables, ['id', 'tags']);
  for (let i = 0; i < 100; i++) assert.equal(t.expand({ id: String(i) }), '/users/' + i);
  assert.equal(t.measure({ id: '😀' }), 19);
  assert.equal(t.trace({ id: '😀' }).uri, '/users/%F0%9F%98%80');
  assert.equal(t.tryExpand({}).error.code, 'MissingBinding');
  assert.equal(t.tryExpand({ id: '42', typo: 'x' }).error.code, 'UnusedBinding');
  assert.throws(() => t.variables.push('changed'), TypeError);
});
test('compilation errors have useful locations and unknown contracts fail early', () => {
  assert.throws(() => compileTemplate('😀{x'), e => e instanceof UriTemplateError && e.code === 'UnclosedExpression' && e.start === 1 && e.utf16Start === 2);
  assert.throws(() => compileTemplate('/{x}', { required: ['typo'] }), { code: 'UnknownRequired' });
  assert.throws(() => compileTemplate("'{x}'"), { code: 'InvalidLiteral' });
  assert.equal(expand("'{x}'", { x: 'v' }, { strict: false }), "'v'");
});
test('JS values cannot silently disappear or invoke getters during serialization', () => {
  const t = compileTemplate('{?x}', { required: ['x'] });
  for (const x of [undefined, NaN, 1, true, new Date(), () => {}, 1n, [, 'a']]) {
    assert.throws(() => t.expand({ x }), { code: 'InvalidInput' });
  }
  let calls = 0;
  assert.throws(() => t.expand({ get x() { calls++; return 'a'; } }), { code: 'InvalidInput' });
  assert.equal(calls, 0);
  const cyclic = {}; cyclic.x = cyclic;
  assert.throws(() => t.expand(cyclic), { code: 'InvalidInput' });
  const repeated = { a: 'v' };
  assert.equal(expand('{?x*,y*}', { x: repeated, y: repeated }), '?a=v&a=v');
});
test('SDK batches enforce atomic budgets with an indexed error', () => {
  const t = compileTemplate('{x}', { required: ['x'] });
  assert.deepEqual(t.expandMany([{ x: 'a' }, { x: '😀' }], { maxTotalOutputBytes: 13 }), ['a', '%F0%9F%98%80']);
  assert.throws(() => t.expandMany([{ x: 'a' }, { x: '😀' }], { maxTotalOutputBytes: 12 }), { code: 'BatchOutputLimit', index: 1 });
  assert.throws(() => t.expandMany([{}]), { code: 'MissingBinding', index: 0 });
  assert.throws(() => t.expandMany([{ x: 'a' }], { maxTotalInputCodepoints: 0 }), { code: 'BatchInputLimit', index: 0 });
  assert.throws(() => t.expandMany([], { maxItems: -1 }), { code: 'InvalidInput' });
  assert.deepEqual(t.expandMany([], { maxItems: 0 }), []);
});
test('prepared requireAll remains stable across check measure trace and repeated calls', () => {
  const t = compileTemplate('{x,y}', { requireAll: true });
  for (let i = 0; i < 50; i++) {
    assert.equal(t.check({ x: 'a' }).missing[0].name, 'y');
    assert.equal(t.measure({ x: 'a', y: 'b' }), 3);
    assert.equal(t.trace({ x: 'a', y: 'b' }).uri, 'a,b');
    assert.equal(t.tryExpand({ x: 'a' }).error.code, 'MissingBinding');
  }
});
test('SDK rejects excessive snapshot text before handing input to the core', () => {
  const t = compileTemplate('{x}');
  assert.throws(() => t.expand({ x: 'a'.repeat(4194305) }), e => e.code === 'JsonInputLimit');
  assert.throws(() => compileTemplate('{x}', { required: ['x'.repeat(65537)] }), e => e.code === 'JsonInputLimit');
});
