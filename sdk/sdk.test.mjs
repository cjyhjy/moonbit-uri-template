import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, expand, UriTemplateError } from './index.mjs';

test('analysis keeps source occurrences and comparison explains modifier changes', () => {
  const before = compileTemplate('😀/{x:2}{x:8}{?tags*}');
  const after = compileTemplate('😀/{x:8}{x:2}{?tags}');
  const info = before.analyze();
  assert.equal(info.offsetUnit, 'unicode-code-point');
  assert.equal(info.profiles[0].firstSpan.start, 3);
  assert.deepEqual(info.profiles[0].prefixes, [2, 8]);
  info.profiles[0].uses.length = 0;
  assert.equal(before.analyze().profiles[0].uses.length, 2);
  const d = before.compare(after);
  assert.equal(d.variableChanges[0].prefixesChanged, true);
  assert.equal(d.variableChanges[1].explodeChanged, true);
  assert.equal(d.requiresReview, true);
  assert.equal(before.compare(before).requiresReview, false);
  assert.throws(() => before.compare('/{x}'), { code: 'InvalidInput' });
});

test('SDK comparison includes required unused and runtime budget changes', () => {
  const before = compileTemplate('/{id}{?page}', { rejectUnused: false, maxOutput: 1024 });
  const after = compileTemplate('/{id}{?page}', { required: ['id'], maxOutput: 128 });
  const d = before.compare(after);
  assert.equal(d.sourceChanged, false);
  assert.equal(d.requiresReview, true);
  assert.deepEqual(d.addedRequired, ['id']);
  assert.deepEqual(d.removedRequired, []);
  assert.equal(d.rejectUnusedBefore, false);
  assert.equal(d.rejectUnusedAfter, true);
  assert.deepEqual(d.budgetChanges, [{ name: 'maxOutput', before: 1024, after: 128, tightened: true }]);
  const reversed = after.compare(before);
  assert.deepEqual(reversed.removedRequired, ['id']);
  assert.equal(reversed.budgetChanges[0].tightened, false);
  assert.equal(compileTemplate('/{id}', { required: ['id', 'id'] })
    .compare(compileTemplate('/{id}', { required: ['id'] })).requiresReview, false);
});

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
