import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAudit } from './main.mjs';
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
});
