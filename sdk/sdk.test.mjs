import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, compileCatalog, expand, UriTemplateError } from './index.mjs';

test('catalog compiles named contracts once and preserves immutable snapshots', () => {
  const definitions = {
    user: { template: '/users/{id}{?page}', required: ['id'] },
    search: { template: '/search{?q}', requireAll: true },
  };
  const c = compileCatalog(definitions);
  definitions.user.template = '/changed';
  definitions.user.required.push('page');
  assert.deepEqual(c.names, ['search', 'user']);
  assert.equal(c.size, 2);
  assert.equal(c.has('user'), true);
  assert.equal(c.has('missing'), false);
  assert.equal(c.get('user'), c.get('user'));
  assert.equal(c.expand('user', { id: '42' }), '/users/42');
  assert.equal(c.measure('user', { id: '42' }), 9);
  assert.equal(c.trace('user', { id: '42' }).uri, '/users/42');
  assert.deepEqual(c.templatesUsing('id'), ['user']);
  assert.throws(() => c.names.push('new'), TypeError);
  assert.throws(() => c.expand('search', {}), { code: 'MissingBinding', templateName: 'search' });
  assert.throws(() => c.get('missing'), { code: 'UnknownTemplate', templateName: 'missing' });
  assert.equal(compileCatalog(JSON.parse('{"__proto__":{"template":"/ok"}}')).expand('__proto__'), '/ok');
});

test('catalog definition validation has bounded counts text and named failures', () => {
  const d = { a: { template: '/😀' } };
  assert.equal(compileCatalog(d, { maxTotalTemplateCodepoints: 3 }).expand('a'), '/%F0%9F%98%80');
  assert.throws(() => compileCatalog(d, { maxTotalTemplateCodepoints: 2 }), { code: 'CatalogInputLimit', templateName: 'a' });
  assert.throws(() => compileCatalog(d, { maxTemplates: 0 }), { code: 'CatalogLimit' });
  assert.throws(() => compileCatalog({}, { typo: 2 }), { code: 'InvalidInput' });
  assert.throws(() => compileCatalog({ bad: { template: '/{id}', required: ['typo'] } }), { code: 'UnknownRequired', templateName: 'bad' });
  assert.throws(() => compileCatalog({ bad: { template: '/{id}', typo: true } }), { code: 'InvalidOptions', templateName: 'bad' });
  let invoked = false;
  assert.throws(() => compileCatalog({ get bad() { invoked = true; return d.a; } }), { code: 'InvalidInput' });
  assert.equal(invoked, false);
});

test('catalog batches measure all requests and enforce aggregate metadata and output budgets', () => {
  const c = compileCatalog({ a: { template: '/{id}', required: ['id'] }, b: { template: '{?q}' } });
  const requests = [{ template: 'a', variables: { id: '😀' } }, { template: 'b', variables: { q: 'x' }, label: 'query' }];
  const input = requests.reduce((n, r) => n + [...JSON.stringify(r)].length, 0);
  const budgets = { maxItems: 2, maxTotalInputCodepoints: input, maxTotalOutputBytes: 17 };
  assert.deepEqual(c.measureMany(requests, budgets), { bytes: [13, 4], totalBytes: 17 });
  assert.deepEqual(c.expandMany(requests, budgets), ['/%F0%9F%98%80', '?q=x']);
  assert.throws(() => c.expandMany(requests, { ...budgets, maxTotalOutputBytes: 16 }), { code: 'BatchOutputLimit', index: 1, templateName: 'b' });
  assert.throws(() => c.expandMany(requests, { ...budgets, maxTotalInputCodepoints: input - 1 }), { code: 'BatchInputLimit', index: 1 });
  assert.throws(() => c.expandMany(requests, { maxItems: 1 }), { code: 'BatchItemLimit', index: -1 });
  assert.throws(() => c.expandMany([requests[0], { template: 'a', variables: {} }]), { code: 'MissingBinding', index: 1, templateName: 'a' });
  assert.throws(() => c.expandMany([{ template: 'typo', variables: {} }]), { code: 'UnknownTemplate', index: 0 });
  assert.throws(() => c.expandMany([{ ...requests[0], typo: 'x' }]), { code: 'InvalidInput', index: 0 });
  assert.throws(() => c.expandMany([], { maxItems: -1 }), { code: 'InvalidInput' });
  let invoked = false;
  const getters = [];
  Object.defineProperty(getters, '0', { enumerable: true, get() { invoked = true; return requests[0]; } });
  assert.throws(() => c.expandMany(getters), { code: 'InvalidInput' });
  assert.equal(invoked, false);
});

test('catalog inspection collects independent contract issues without treating optional omissions as errors', () => {
  const c = compileCatalog({ a: { template: '/{id}{?page}', required: ['id'] }, b: { template: '{x:2}' } });
  const report = c.inspect([
    { template: 'a', variables: { typo: 'SECRET' }, label: 'first' },
    { template: 'b', variables: { x: ['one'] } },
    { template: 'absent', variables: {} },
  ]);
  assert.equal(report.ok, false);
  assert.equal(report.totalFindings, 4);
  assert.equal(report.requests[0].label, 'first');
  assert.deepEqual(report.requests[0].findings.map(f => f.code).sort(), ['MissingBinding', 'UnusedBinding']);
  assert.equal(report.requests[1].findings[0].code, 'PrefixOnComposite');
  assert.equal(report.requests[2].findings[0].code, 'UnknownTemplate');
  assert.equal(report.requests[2].findings[0].start, undefined);
  assert.equal(JSON.stringify(report).includes('SECRET'), false);
  assert.equal(c.inspect([{ template: 'a', variables: { id: '42' } }], { maxFindings: 0 }).ok, true);
  assert.throws(() => c.inspect([{ template: 'a', variables: {} }], { maxFindings: 0 }), { code: 'FindingLimit', index: 0 });
  assert.throws(() => c.inspect([{ template: 'absent', variables: {} }], { maxFindings: 0 }), { code: 'FindingLimit' });
  assert.throws(() => c.inspect([], { maxFindings: -1 }), { code: 'InvalidInput' });
});

test('catalog policy audit validates empty catalogs and caps the combined report', () => {
  const c = compileCatalog({ a: { template: '/{+x}' }, b: { template: '/{+y}' } });
  const audit = c.audit({ allowReserved: false });
  assert.equal(audit.totalFindings, 2);
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.entries.map(e => e.template), ['a', 'b']);
  assert.throws(() => c.audit({ allowReserved: false }, { maxFindings: 1 }), { code: 'FindingLimit', templateName: 'b' });
  assert.equal(c.audit({ allowedVariables: ['x', 'y'] }).ok, true);
  assert.equal(c.audit({ allowedVariables: ['x'] }).totalFindings, 1);
  assert.equal(c.audit({ allowedVariables: null }).ok, true);
  for (const policy of [{ typo: true }, { allowReserved: 'no' }, { allowedVariables: [1] }, { maxReferences: -1 }])
    assert.throws(() => compileCatalog({}).audit(policy), { code: 'InvalidPolicy' });
  assert.throws(() => compileCatalog({}).audit({}, { maxFindings: -1 }), { code: 'InvalidInput' });
});

test('catalog comparison includes additions removals and runtime-only contract changes', () => {
  const before = compileCatalog({ a: { template: '/{id}' }, removed: { template: '/old' } });
  const after = compileCatalog({ a: { template: '/{id}', required: ['id'], maxOutput: 12 }, added: { template: '/new' } });
  const diff = before.compare(after);
  assert.deepEqual(diff.added, ['added']);
  assert.deepEqual(diff.removed, ['removed']);
  assert.deepEqual(diff.changed[0].change.addedRequired, ['id']);
  assert.equal(diff.changed[0].change.sourceChanged, false);
  assert.equal(diff.totalChanges, 3);
  assert.equal(diff.requiresReview, true);
  assert.equal(before.compare(before, { maxChanges: 0 }).requiresReview, false);
  assert.throws(() => before.compare(after, { maxChanges: 2 }), { code: 'CatalogChangeLimit' });
  assert.throws(() => before.compare({}), { code: 'InvalidInput' });
  assert.throws(() => before.compare(Object.create(Object.getPrototypeOf(before))), { code: 'InvalidInput' });
});

test('single-template inspection and policy audit preserve Unicode editor locations', () => {
  const t = compileTemplate('😀/{+id}{?page}', { required: ['id'] });
  assert.equal(t.inspect({ id: '42' }).length, 0);
  const missing = t.inspect({})[0];
  assert.equal(missing.code, 'MissingBinding');
  assert.equal(missing.utf16Start, missing.start + 1);
  assert.equal(t.audit({ allowReserved: false }).length, 1);
  assert.throws(() => t.inspect({}, { maxFindings: 0 }), { code: 'FindingLimit' });
  assert.throws(() => t.audit({ allowReserved: false }, { maxFindings: 0 }), { code: 'FindingLimit' });
});

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
