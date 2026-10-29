import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { endpoint } = await import(pathToFileURL(resolve(process.argv[2])).href);
const results = [];
function check(name, fn) {
  fn();
  results.push({ name, status: 'passed' });
}
check('repository request', () => {
  assert.equal(endpoint('GET /repos/{owner}/{repo}', { owner: 'octokit', repo: 'endpoint.js' }).url,
    'https://api.github.com/repos/octokit/endpoint.js');
});
check('branch ID encodes slash and space', () => {
  assert.equal(endpoint('GET /repos/{owner}/{repo}/git/matching-refs/{ref}',
    { owner: 'o', repo: 'r', ref: 'heads/a b' }).url,
    'https://api.github.com/repos/o/r/git/matching-refs/heads%2Fa%20b');
});
check('bigint preserves precision above Number.MAX_SAFE_INTEGER', () => {
  assert.equal(endpoint('POST /app/hook/deliveries/{id}/attempts', { id: 9007199254740993n }).url,
    'https://api.github.com/app/hook/deliveries/9007199254740993/attempts');
});
check('omitted path variable keeps Octokit trailing-slash convention', () => {
  assert.equal(endpoint('GET /repos/{owner}/{repo}/branches/{branch}', { owner: 'o', repo: 'r' }).url,
    'https://api.github.com/repos/o/r/branches');
});
check('root slash is preserved', () => {
  assert.equal(endpoint('GET /').url, 'https://api.github.com/');
});
for (const [name, data] of [['Uint8Array', new Uint8Array([0, 255, 1])], ['Blob', new Blob(['payload'])]]) {
  check(name + ' request body is not serialized by the URI SDK', () => {
    const result = endpoint('POST /upload/{id}', { id: 42, data });
    assert.equal(result.url, 'https://api.github.com/upload/42');
    assert.equal(result.body, data);
  });
}
check('unused bigint JSON-body field is left to Octokit', () => {
  const result = endpoint('POST /items/{id}', { id: 42, large: 9007199254740993n });
  assert.equal(result.url, 'https://api.github.com/items/42');
  assert.deepEqual({ ...result.body }, { large: 9007199254740993n });
});

// This uncovered legacy behavior is not covered by the upstream tests. Keep
// both observed outputs explicit instead of making a universal parity claim.
const exploded = endpoint('GET /search{?tags*}', { tags: ['moon bit', 'uri'] }).url;
const expectedExploded = process.argv.includes('--baseline')
  ? 'https://api.github.com/search?tags=moon%20bit,tags=uri'
  : 'https://api.github.com/search?tags=moon%20bit&tags=uri';
assert.equal(exploded, expectedExploded);
const report = { status: 'passed', checks: results,
  compatibility_probes: [{ name: 'exploded query list', url: exploded,
    baseline_expected_to_differ: true, rfc6570_separator: '&' }], live: { performed: false } };
if (process.argv.includes('--live')) {
  const options = endpoint('GET /repos/{owner}/{repo}', { owner: 'octokit', repo: 'endpoint.js' });
  assert.equal(options.method, 'GET');
  assert.equal(options.url, 'https://api.github.com/repos/octokit/endpoint.js');
  const response = await fetch(options.url, { method: options.method, headers: options.headers,
    redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= 1048576);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const body = JSON.parse(bytes);
  assert.equal(body.full_name, 'octokit/endpoint.js');
  report.live = { performed: true, method: options.method, url: options.url, status: response.status,
    bytes: size, sha256: createHash('sha256').update(bytes).digest('hex'), full_name: body.full_name };
}
console.log(JSON.stringify(report, null, 2));
