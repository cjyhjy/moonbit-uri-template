// Check pinned public OpenAPI descriptions; the documents are downloaded, not vendored.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { checkOpenAPI, summary } from './openapi.mjs';

const MAX_BYTES = 67108864;
const specs = [
  { name: 'github', repository: 'github/rest-api-description', commit: '755ee33b4a81d51f6f07a902cce26cbec3b822f2',
    file: 'descriptions/api.github.com/api.github.com.json',
    sha256: '3177ad6a86ca04c57a9bef3fc24e28a339efb8eb040c6f950af3d3ed2fee7fa3' },
  { name: 'stripe', repository: 'stripe/openapi', commit: 'b339867409bf2fb41b6c3411804de1ec4ebf6a49',
    file: 'openapi/spec3.json',
    sha256: '7cff4cc46d0654101a36a3302f7544640f5f73e4f3cad6f264f0e23c19fa1776' },
  { name: 'cloudflare', repository: 'cloudflare/api-schemas', commit: 'b3bacb18fcfbb6c5b5c4e9cc0990d055673b39a4',
    file: 'openapi.json',
    sha256: '4ba217d8b7316bbc84a94370a216e6fb4ab77180cac82464f91e8969e19a48fd' },
];

async function download(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_BYTES) throw new Error('ResponseSizeLimit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const tally = items => items.reduce((counts, x) => ({ ...counts, [x]: (counts[x] ?? 0) + 1 }), {});
const output = new URL('../reports/openapi-public.json', import.meta.url);
const report = { schemaVersion: 1, evidence: 'pinned-public-openapi', status: 'running', node: process.version, startedAt: new Date().toISOString(), results: [] };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
// Overwrite first so a failed run never leaves an earlier result in place.
save();
try {
  for (const spec of specs) {
    const url = `https://raw.githubusercontent.com/${spec.repository}/${spec.commit}/${spec.file}`;
    const bytes = await download(url);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== spec.sha256) throw new Error(`${spec.name}: checksum mismatch`);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const started = performance.now();
    const result = checkOpenAPI(text, spec.file, { maxBytes: MAX_BYTES });
    const elapsedMs = Math.round(performance.now() - started);
    report.results.push({
      name: spec.name, repository: spec.repository, commit: spec.commit, url, bytes: bytes.length, sha256,
      openapi: JSON.parse(text).openapi, elapsedMs, ok: result.ok, complete: result.complete,
      operations: result.operations.length,
      templates: result.operations.filter(o => o.template !== null).length,
      examples: result.operations.filter(o => o.example !== null).length,
      unsupported: tally(result.operations.flatMap(o => o.unsupported.map(u => u.reason))),
      errors: tally(result.diagnostics.filter(d => d.severity === 'error').map(d => d.code)),
      warnings: tally(result.diagnostics.filter(d => d.severity === 'warning').map(d => d.code)),
      truncated: result.truncated, diagnostics: result.diagnostics,
    });
    console.log(`${spec.name} (${elapsedMs} ms): ${summary(result).trim()}`);
    for (const d of result.diagnostics.filter(d => d.severity === 'error')) console.log(`  ${d.file}:${d.line}:${d.column} ${d.code}: ${d.message}`);
  }
  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
}
report.finishedAt = new Date().toISOString();
save();
