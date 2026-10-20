// A standalone consumer: builds all URLs via the public typed catalog SDK.
// Network access is GET-only and limited to GitHub's public repository API.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

// Use gh's existing credential handling; never extract or persist a token.
export async function githubCliFetch(uri) {
  let stdout;
  try {
    ({ stdout } = await execute('gh', ['api', '--method', 'GET', '--include', uri, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'], { timeout: 20000, maxBuffer: 1100000, encoding: 'buffer' }));
  } catch (e) {
    if (!e.stdout?.length) throw new Error('NetworkError');
    stdout = e.stdout;
  }
  const text = stdout.toString('utf8'), boundary = text.search(/\r?\n\r?\n/);
  if (boundary < 0) throw new Error('NetworkError');
  const head = text.slice(0, boundary).split(/\r?\n/);
  const status = Number(head.shift().match(/^HTTP\/\S+ (\d{3})/)?.[1]);
  const headers = new Headers();
  for (const line of head) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
  }
  return new Response(text.slice(boundary).replace(/^\r?\n\r?\n/, ''), { status, headers });
}

import { readProjectFile } from '../../tools/project.mjs';
import { prepareAudit, destinationProblems } from './contracts.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function runAudit(manifest, { fetcher = fetch, evidence = 'live-github-api', file = 'requests.json' } = {}) {
  const plan = prepareAudit(manifest, file);
  const report = { schemaVersion: 1, evidence, startedAt: new Date().toISOString(), manifestSha256: sha(manifest),
    status: 'running', checks: plan.checks, executionPath: plan.executionPath,
    sdk: { inspection: plan.inspection, error: plan.error, totalOutputBytes: plan.totalOutputBytes }, responses: [] };
  if (!plan.ok) { report.status = plan.checks.ok ? 'sdk-contract-failed' : 'contract-failed'; return report; }
  // Validate every URL before the first network request. URL parsing can normalize
  // dot segments, so reject noncanonical paths as well as unexpected origins.
  report.destinationProblems = destinationProblems(plan.outputs);
  if (report.destinationProblems.length) { report.status = 'destination-rejected'; return report; }
  for (const item of plan.outputs) {
    let response;
    try {
      response = await fetcher(item.uri, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'moonbit-uri-template-integration' } });
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 1048576) throw new Error('ResponseSizeLimit');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks), payload = JSON.parse(bytes.toString('utf8'));
      const record = { label: item.label, url: item.uri, status: response.status,
        receivedAt: new Date().toISOString(), requestId: response.headers.get('x-github-request-id'),
        etag: response.headers.get('etag'), responseDate: response.headers.get('date'),
        bodySha256: sha(bytes), responseBytes: size };
      if (!response.ok) {
        record.error = 'GitHubHttpError';
      } else if (item.template === 'repository') {
        if (typeof payload.full_name !== 'string' || typeof payload.default_branch !== 'string') throw new Error('ResponseSchema');
        record.data = { full_name: payload.full_name, default_branch: payload.default_branch, archived: payload.archived, html_url: payload.html_url };
      } else if (item.template === 'commits') {
        if (!Array.isArray(payload) || !/^[a-f0-9]{40}$/.test(payload[0]?.sha ?? '')) throw new Error('ResponseSchema');
        record.data = { sha: payload[0].sha, html_url: payload[0].html_url };
      } else {
        if (!Array.isArray(payload)) throw new Error('ResponseSchema');
        record.data = { releases: payload.map(r => ({ tag_name: r.tag_name, html_url: r.html_url, published_at: r.published_at })) };
      }
      report.responses.push(record);
      if (!response.ok) break;
    } catch (e) {
      report.responses.push({ label: item.label, url: item.uri, error: ['ResponseSchema', 'ResponseSizeLimit'].includes(e.message) ? e.message : 'NetworkError', status: response?.status ?? null });
      break;
    }
  }
  report.status = report.responses.length === plan.outputs.length && report.responses.every(r => !r.error) ? 'passed' : 'failed';
  report.completedAt = new Date().toISOString();
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cliArgs = process.argv.slice(2);
  const useGh = cliArgs[0] === '--gh';
  if (useGh) cliArgs.shift();
  const [manifestPath = fileURLToPath(new URL('requests.json', import.meta.url)),
    reportPath = fileURLToPath(new URL('../../reports/github-integration-live.json', import.meta.url)), ...extra] = cliArgs;
  if (extra.length) throw new Error('Usage: node main.mjs [manifest.json] [report.json]');
  const report = await runAudit(readProjectFile(manifestPath), { file: manifestPath, ...(useGh ? { fetcher: githubCliFetch } : {}) });
  report.transport = useGh ? 'authenticated-gh-cli' : 'node-fetch-anonymous';
  report.engineSha256 = sha(await readFile(new URL('../../dist/engine.mjs', import.meta.url)));
  await mkdir(dirname(resolve(reportPath)), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${report.responses.length} HTTP responses; ${reportPath}`);
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
