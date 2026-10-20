import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runAudit } from './main.mjs';
import { reviewUpgrade } from './upgrade.mjs';
import { destinationProblems } from './contracts.mjs';
const original = JSON.parse(readFileSync(new URL('requests.json', import.meta.url)));

test('typo prevents every network call and returns both missing and unused findings', async () => {
  const doc = structuredClone(original);
  doc.requests[0].variables.owenr = doc.requests[0].variables.owner;
  delete doc.requests[0].variables.owner;
  let count = 0;
  const r = await runAudit(JSON.stringify(doc), { evidence: 'offline-fault-injection', fetcher: () => { count++; throw Error('unexpected network'); } });
  assert.equal(count, 0);
  assert.equal(r.status, 'contract-failed');
  assert.deepEqual(r.checks.outputs, []);
  assert.deepEqual(r.checks.diagnostics.map(d => d.code), ['MissingBinding', 'UnusedBinding']);
});

test('client verifies all destinations before any request', async () => {
  const doc = structuredClone(original);
  doc.templates[2].template = 'https://example.com/repos/{owner}/{repo}/releases{?per_page}';
  let count = 0;
  const r = await runAudit(JSON.stringify(doc), { evidence: 'offline-fault-injection', fetcher: () => { count++; } });
  assert.equal(count, 0);
  assert.equal(r.status, 'destination-rejected');
});

test('offline HTTP failures and malformed success payloads are never success evidence', async () => {
  const failed = await runAudit(JSON.stringify(original), { evidence: 'offline-double', fetcher: async () => new Response('{}', { status: 403 }) });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.responses[0].status, 403);
  const malformed = await runAudit(JSON.stringify(original), { evidence: 'offline-double', fetcher: async () => new Response('{}') });
  assert.equal(malformed.status, 'failed');
  assert.equal(malformed.responses[0].error, 'ResponseSchema');
});

test('offline success reads all nine outputs using the compiled core', async () => {
  const r = await runAudit(JSON.stringify(original), { evidence: 'offline-double', fetcher: async uri =>
    new Response(JSON.stringify(uri.includes('/commits') ? [{ sha: 'a'.repeat(40) }] :
      uri.includes('/releases') ? [] : { full_name: 'example/repo', default_branch: 'main' })) });
  assert.equal(r.status, 'passed');
  assert.equal(r.responses.length, 9);
  assert.equal(r.evidence, 'offline-double');
  assert.equal(r.executionPath, 'typed-catalog-sdk');
  assert.equal(r.sdk.inspection.ok, true);
  assert.equal(r.sdk.totalOutputBytes, r.checks.totalOutputBytes);
});

test('catalog metadata input budget fails before any HTTP even if project variables fit', async () => {
  const doc = structuredClone(original);
  doc.maxTotalInputCodepoints = doc.requests.reduce((n, r) => n + [...JSON.stringify(r.variables)].length, 0);
  let calls = 0;
  const r = await runAudit(JSON.stringify(doc), { evidence: 'offline-double', fetcher: async () => { calls++; } });
  assert.equal(r.checks.ok, true);
  assert.equal(r.status, 'sdk-contract-failed');
  assert.equal(r.sdk.error.code, 'BatchInputLimit');
  assert.equal(calls, 0);
});

test('malformed relative and normalized destinations return failures without throwing', () => {
  for (const uri of ['/%bad', 'https://api.github.com/repos/a/../b', 'https://example.com/repos/a/b',
    'https://api.github.com/repos/a/b?per_page=2', 'https://api.github.com/repos/a/b#x'])
    assert.equal(destinationProblems([{ index: 0, uri }])[0].code, 'DestinationRejected');
  assert.deepEqual(destinationProblems([{ uri: 'https://api.github.com/repos/a/b?per_page=1' }]), []);
});

const review = doc => reviewUpgrade(JSON.stringify(original), JSON.stringify(doc));
test('upgrade no-op and object key reordering pass without compatibility claims', () => {
  const reversed = JSON.parse(JSON.stringify(original), (key, value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
  const r = review(reversed);
  assert.equal(r.status, 'unchanged');
  assert.equal(r.requiresReview, false);
  assert.equal(r.networkCalls, 0);
  assert.equal(r.candidate.ok, true);
  assert.equal(r.existingRequests.ok, true);
  assert.match(r.note, /not an automatic compatibility certificate/);
});

test('upgrade optional variable requires review while existing requests still pass', () => {
  const doc = structuredClone(original);
  doc.templates[0].template += '{?per_page}';
  doc.templates[0].types.per_page = 'scalar';
  const r = review(doc);
  assert.equal(r.status, 'review-required');
  assert.equal(r.candidate.ok, true);
  assert.equal(r.existingRequests.ok, true);
  assert.deepEqual(r.catalog.changed[0].change.addedVariables, ['per_page']);
  assert.equal(r.typeChanges[0].template, 'repository');
});

test('upgrade checks retained requests even when candidate requests were repaired', () => {
  const doc = structuredClone(original);
  doc.templates[0].template += '{?per_page}';
  doc.templates[0].required.push('per_page');
  for (const request of doc.requests) if (request.template === 'repository') request.variables.per_page = '1';
  const r = review(doc);
  assert.equal(r.status, 'blocked');
  assert.equal(r.candidate.ok, true);
  assert.equal(r.existingRequests.ok, false);
  assert.equal(r.existingRequests.inspection.totalFindings, 3);
  assert.equal(r.existingRequests.checks.diagnostics[0].file, '<existing-requests-with-candidate-definitions>');
  assert.equal(r.requestChanges.length, 3);
  assert.deepEqual(r.catalog.changed[0].change.addedRequired, ['per_page']);
});

test('upgrade catches type-only aggregate budget and destination-only regressions', () => {
  const typed = structuredClone(original);
  typed.templates[0].types.owner = 'list';
  const t = review(typed);
  assert.equal(t.status, 'blocked');
  assert.equal(t.catalog.requiresReview, false);
  assert.equal(t.typeChanges.length, 1);
  assert.equal(t.candidate.checks.diagnostics[0].code, 'BindingType');
  const bounded = structuredClone(original);
  bounded.maxTotalOutputBytes = 1;
  const b = review(bounded);
  assert.equal(b.status, 'blocked');
  assert.equal(b.batchBudgetChanges[0].tightened, true);
  assert.equal(b.candidate.checks.diagnostics[0].code, 'ProjectOutputLimit');
  const redirected = structuredClone(original);
  redirected.templates[0].template = 'https://example.com/repos/{owner}/{repo}';
  const d = review(redirected);
  assert.equal(d.status, 'blocked');
  assert.equal(d.candidate.checks.ok, true);
  assert.equal(d.candidate.destinations.length, 3);
});

test('upgrade rejects invalid definitions duplicate keys and unbounded request shapes', () => {
  const bad = structuredClone(original);
  bad.templates[0].template = '{invalid';
  assert.equal(review(bad).status, 'invalid-candidate');
  const duplicate = JSON.stringify(original).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
  assert.equal(reviewUpgrade(JSON.stringify(original), duplicate).status, 'invalid-candidate');
  for (const requests of [null, 'x'.repeat(10000), Array(257).fill({})]) {
    const doc = { ...original, requests };
    assert.equal(review(doc).status, 'invalid-candidate');
  }
  assert.equal(reviewUpgrade('{}', JSON.stringify(original)).status, 'invalid-baseline');
});

test('upgrade reports binding changes without copying secret values or generated URLs', () => {
  const doc = structuredClone(original);
  doc.requests[0].variables.repo = 'SECRET_VALUE';
  const r = review(doc);
  assert.equal(r.status, 'review-required');
  assert.equal(r.requestChanges[0].index, 0);
  assert.equal(JSON.stringify(r).includes('SECRET_VALUE'), false);
  assert.equal(JSON.stringify(r).includes('https://api.github.com/repos/'), false);
});

test('upgrade CLI is offline and reports deterministic exit statuses', () => {
  const script = new URL('upgrade.mjs', import.meta.url);
  const manifest = new URL('requests.json', import.meta.url);
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(script), ...args], { encoding: 'utf8' });
  const unchanged = run(fileURLToPath(manifest), fileURLToPath(manifest));
  assert.equal(unchanged.status, 0);
  assert.equal(JSON.parse(unchanged.stdout).status, 'unchanged');
  assert.equal(run().status, 2);
  const missing = run(fileURLToPath(manifest), fileURLToPath(new URL('does-not-exist.json', import.meta.url)));
  assert.equal(missing.status, 2);
  assert.equal(JSON.parse(missing.stdout).error.code, 'FileError');
  const temporary = mkdtempSync(join(tmpdir(), 'uri-upgrade-'));
  try {
    const candidate = join(temporary, 'candidate.json'), doc = structuredClone(original);
    doc.templates[0].maxOutputBytes = 513;
    writeFileSync(candidate, JSON.stringify(doc));
    const changed = run(fileURLToPath(manifest), candidate);
    assert.equal(changed.status, 1);
    assert.equal(JSON.parse(changed.stdout).status, 'review-required');
    doc.maxTotalOutputBytes = 1;
    writeFileSync(candidate, JSON.stringify(doc));
    const blocked = run(fileURLToPath(manifest), candidate);
    assert.equal(blocked.status, 1);
    assert.equal(JSON.parse(blocked.stdout).status, 'blocked');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
