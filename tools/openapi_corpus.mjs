// Reproducible public-input coverage. Catalog diagnostics are candidates, not confirmed upstream bugs.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
export const INDEX_URL = 'https://api.apis.guru/v2/list.json';
const CACHE = resolve(ROOT, '_build/openapi-corpus');
const LOCK = resolve(ROOT, 'testdata/openapi-corpus/manifest.json');
const REPORT = resolve(ROOT, 'reports/openapi-corpus.json');
const MAX_BYTES = 64 * 1024 * 1024;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); };
const tally = values => values.reduce((out, value) => { out[value] = (out[value] ?? 0) + 1; return out; }, {});
const supported = value => /^3\.[01](?:\.|$)/.test(value);

// Prefer one API per provider; include the small 3.1 cohort before the 3.0 cohort.
// Stable hash ordering avoids alphabetical and large-cloud-provider domination.
export function selectDocuments(index, limit) {
  const candidates = Object.entries(index).flatMap(([id, api]) => {
    const version = api.versions?.[api.preferred];
    if (!version || !supported(version.openapiVer)) return [];
    return [{ id, provider: version.info?.['x-providerName'] ?? id.split(':')[0], version: api.preferred,
      openapi: version.openapiVer, url: version.swaggerUrl, yamlUrl: version.swaggerYamlUrl,
      origins: version.info?.['x-origin'] ?? [], categories: version.info?.['x-apisguru-categories'] ?? [],
      rank: sha256('uri-template-corpus-v1:' + id) }];
  }).sort((a, b) => a.rank.localeCompare(b.rank));
  const selected = [], providers = new Set(), ids = new Set();
  for (const group of [candidates.filter(x => x.openapi.startsWith('3.1')), candidates]) {
    for (const item of group) if (!providers.has(item.provider) && selected.length < limit) {
      providers.add(item.provider); ids.add(item.id); selected.push(item);
    }
  }
  for (const item of candidates) if (!ids.has(item.id) && selected.length < limit) selected.push(item);
  return selected.map(({rank, ...item}) => item);
}

export async function download(url, maxBytes = MAX_BYTES, consume = () => {}) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://api.apis.guru' || parsed.username || parsed.password || parsed.port)
    throw new Error('only the APIs.guru HTTPS catalog origin is allowed');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'moonbit-uri-template-corpus/0.4.0', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    consume(chunk.length);
    if (length > maxBytes) { await response.body.cancel().catch(() => {}); throw new Error('download size limit'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function snapshot(limit, indexPath, lockPath) {
  const bytes = indexPath ? readFileSync(indexPath) : await download(INDEX_URL, 20 * 1024 * 1024);
  const index = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const documents = selectDocuments(index, limit);
  const lock = { schemaVersion: 1, status: 'running', createdAt: new Date().toISOString(),
    catalog: { url: INDEX_URL, sha256: sha256(bytes), bytes: bytes.length, entries: Object.keys(index).length },
    selection: 'uri-template-corpus-v1: preferred OpenAPI 3.0/3.1, one per provider first, 3.1 providers first, SHA-256 order',
    evidence: 'APIs.guru catalog copies, potentially transformed; verify original sources before upstream attribution',
    requested: limit, documents };
  mkdirSync(CACHE, { recursive: true });
  save(lockPath, lock);
  // Four concurrent downloads with no automatic execution of downloaded content.
  let next = 0, totalBytes = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < documents.length) {
      const item = documents[next++];
      try {
        if (totalBytes >= 512 * 1024 * 1024) throw new Error('snapshot total download budget exceeded');
        const data = await download(item.url, MAX_BYTES, size => {
          totalBytes += size;
          if (totalBytes > 512 * 1024 * 1024) throw new Error('snapshot total download budget exceeded');
        });
        const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
        if (!supported(doc.openapi)) throw new Error('document version differs from supported catalog selection');
        item.sha256 = sha256(data); item.bytes = data.length; item.openapi = doc.openapi;
        writeFileSync(resolve(CACHE, item.sha256 + '.json'), data);
        item.status = 'pinned';
      } catch (error) { item.status = 'download-failed'; item.error = error.message; }
      save(lockPath, lock);
      console.log(`${item.status}: ${item.id}`);
    }
  }));
  lock.status = documents.length === limit && documents.every(x => x.status === 'pinned') ? 'complete' : 'incomplete';
  save(lockPath, lock);
  return lock.status === 'complete' ? 0 : 1;
}

export function inspectReport(report) {
  const semantic = {...report, file:undefined, scope:undefined,
    diagnostics:report.diagnostics.map(({file, line, column, ...diagnostic}) => diagnostic)};
  return { outcome: !report.complete ? 'incomplete' : report.ok ? 'complete-clean' : 'complete-with-diagnostics',
    ok: report.ok, complete: report.complete, operations: report.operations.length,
    templates: report.operations.filter(x => x.template !== null).length,
    unsupportedParameters: tally(report.operations.flatMap(x => x.unsupported.map(y => y.reason))),
    codes: tally(report.diagnostics.map(x => x.code)), truncated: report.truncated,
    diagnostics: report.diagnostics,
    semanticSha256: sha256(JSON.stringify(semantic)) };
}

function worker(path) {
  return import('./openapi.mjs').then(({checkOpenAPI}) => {
    const text = new TextDecoder('utf-8', {fatal:true}).decode(readFileSync(path));
    const yaml = path.endsWith('.yaml');
    // Feature inventory is for JSON catalog copies; the paired YAML check uses
    // exactly the same semantic digest without interpreting the input twice.
    const doc = yaml ? null : JSON.parse(text);
    let externalReferences = 0;
    const stack = [doc];
    while (stack.length) {
      const value = stack.pop();
      if (value && typeof value === 'object') {
        if (typeof value.$ref === 'string' && !value.$ref.startsWith('#')) externalReferences++;
        for (const child of Object.values(value)) stack.push(child);
      }
    }
    const start = performance.now();
    const report = checkOpenAPI(text, yaml ? 'catalog.yaml' : 'catalog.json', {maxBytes: MAX_BYTES});
    console.log(JSON.stringify({...inspectReport(report), elapsedMs: Math.round(performance.now() - start),
      externalReferences:yaml ? null : externalReferences, maxRssKiB: process.resourceUsage().maxRSS}));
  });
}

export function runWorker(path, timeout = 15000) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=512', SELF, '--worker', path],
    { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 });
  if (result.error?.code === 'ETIMEDOUT') return { outcome: 'timeout', timeoutMs: timeout };
  if (result.error || result.status !== 0) return { outcome: 'crash', error: result.error?.message ?? result.stderr.slice(-1500), signal: result.signal };
  try { return JSON.parse(result.stdout); }
  catch { return { outcome: 'crash', error: 'worker did not return JSON' }; }
}

export function compareBaseline(results, baseline) {
  return results.flatMap(row => {
    const expected = baseline.documents.find(item => item.id === row.id);
    if (!expected) return [{id:row.id,reason:'not present in baseline'}];
    if (expected.sha256 !== row.sha256) return [{id:row.id,reason:'input changed'}];
    if (!row.semanticSha256 || expected.semanticSha256 !== row.semanticSha256) return [{id:row.id,reason:'analysis changed or failed'}];
    return [];
  });
}

async function check(lockPath, reportPath, limit, allowDownload, baselinePath) {
  const lockBytes = readFileSync(lockPath), lock = JSON.parse(lockBytes);
  const report = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(), evidence: lock.evidence,
    manifestSha256: sha256(lockBytes), node: process.version,
    analyzerSha256: sha256(readFileSync(resolve(ROOT, 'dist/engine.mjs'))),
    adapterSha256:sha256(['tools/openapi.mjs','tools/json-source.mjs','tools/yaml-source.mjs','sdk/openapi.mjs'].map(name => name+'\0'+readFileSync(resolve(ROOT,name),'utf8')).join('\0')),
    runnerSha256: sha256(readFileSync(SELF)), externalUserFeedback: false, results: [] };
  save(reportPath, report);
  for (const item of lock.documents.slice(0, limit)) {
    const row = { id: item.id, provider: item.provider, openapi: item.openapi, sha256: item.sha256, bytes: item.bytes };
    try {
      if (item.status !== 'pinned' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('snapshot is not pinned');
      const path = resolve(CACHE, item.sha256 + '.json');
      if (!existsSync(path) && allowDownload) { mkdirSync(CACHE, {recursive:true}); writeFileSync(path, await download(item.url)); }
      const data = readFileSync(path);
      if (data.length !== item.bytes || sha256(data) !== item.sha256) throw new Error('pinned content checksum mismatch');
      Object.assign(row, runWorker(path));
    } catch (error) { row.outcome = 'input-unavailable'; row.error = error.message.replaceAll(ROOT, '<repository>'); }
    report.results.push(row); save(reportPath, report);
    console.log(`${row.outcome}: ${item.id}`);
  }
  report.summary = { documents: report.results.length, providers: new Set(report.results.map(x => x.provider)).size,
    versions: tally(report.results.map(x => x.openapi)), outcomes: tally(report.results.map(x => x.outcome)),
    operations: report.results.reduce((n, x) => n + (x.operations ?? 0), 0),
    codes: tally(report.results.flatMap(x => (x.diagnostics ?? []).map(d => d.code))),
    documentsWithExternalReferences: report.results.filter(x => x.externalReferences > 0).length };
  report.status = report.results.length && report.results.every(x => !['crash','timeout','input-unavailable'].includes(x.outcome)) ? 'completed' : 'failed';
  if (baselinePath) {
    const bytes = readFileSync(baselinePath);
    report.baselineSha256=sha256(bytes);
    report.regressions=compareBaseline(report.results,JSON.parse(bytes));
    if (report.regressions.length) report.status='failed';
  }
  report.finishedAt = new Date().toISOString(); save(reportPath, report);
  console.log(JSON.stringify(report.summary, null, 2));
  return report.status === 'completed' ? 0 : 1;
}

async function main(args) {
  if (args[0] === '--worker' && args.length === 2) return worker(args[1]);
  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: node tools/openapi_corpus.mjs snapshot|check [--limit N] [--manifest FILE] [--report FILE] [--index FILE] [--baseline FILE] [--download]\nSnapshot downloads and pins public catalog documents. Check uses the local hash cache unless --download is supplied. Reports distinguish diagnostics, incomplete checks and process failures; they do not assert upstream bugs. --baseline fails on any changed analysis or input.');
    return;
  }
  const [mode, ...rest] = args, options = {limit: mode === 'snapshot' ? 50 : Infinity, manifest: LOCK, report: REPORT};
  if (!['snapshot', 'check'].includes(mode)) throw new Error('unknown corpus command');
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--download') options.download = true;
    else if (['--limit','--manifest','--report','--index','--baseline'].includes(arg) && rest[i+1] && !rest[i+1].startsWith('--')) options[arg.slice(2)] = rest[++i];
    else throw new Error('invalid corpus option: ' + arg);
  }
  if (options.limit !== Infinity && (!/^\d+$/.test(String(options.limit)) || Number(options.limit) < 1 || Number(options.limit) > 500)) throw new Error('limit must be 1..500');
  process.exitCode = mode === 'snapshot' ? await snapshot(Number(options.limit), options.index, options.manifest)
    : await check(options.manifest, options.report, Number(options.limit), options.download, options.baseline);
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
