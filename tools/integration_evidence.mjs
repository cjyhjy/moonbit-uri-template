import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runAudit } from '../integrations/github-audit/main.mjs';
import { reviewUpgrade } from '../integrations/github-audit/upgrade.mjs';
const original = JSON.parse(readFileSync(new URL('../integrations/github-audit/requests.json', import.meta.url)));
const cases = [
  ['misspelled-required', d => {
    d.requests[0].variables.owenr = d.requests[0].variables.owner;
    delete d.requests[0].variables.owner;
  }, ['MissingBinding', 'UnusedBinding']],
  ['empty-required', d => { d.requests[0].variables.owner = []; }, ['BindingType', 'OmittedBinding']],
  ['aggregate-budget', d => { d.maxTotalOutputBytes = 1; }, ['ProjectOutputLimit']],
];
const results = [];
for (const [name, mutate, expected] of cases) {
  const doc = structuredClone(original); mutate(doc);
  let networkCalls = 0;
  const result = await runAudit(JSON.stringify(doc, null, 2), {
    evidence: 'intentional-fault-injection',
    file: 'integrations/github-audit/requests.json',
    fetcher: async () => { networkCalls++; throw new Error('unexpected network'); },
  });
  if (networkCalls || result.status !== 'contract-failed' ||
      expected.some(code => !result.checks.diagnostics.some(d => d.code === code))) throw new Error('Fault check failed: ' + name);
  results.push({ name, expected, networkCalls, result });
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
writeFileSync(new URL('../reports/integration-faults.json', import.meta.url), JSON.stringify({
  status: 'passed', evidence: 'intentional-fault-injection', generatedAt: new Date().toISOString(),
  engineSha256: sha(readFileSync(new URL('../dist/engine.mjs', import.meta.url))),
  manifestSha256: sha(readFileSync(new URL('../integrations/github-audit/requests.json', import.meta.url))),
  results,
}, null, 2) + '\n');
console.log('Three injected-fault scenarios passed; zero network requests.');

const upgradeCases = [
  ['unchanged', () => {}, 'unchanged'],
  ['optional-query', doc => {
    doc.templates[0].template += '{?per_page}';
  }, 'review-required'],
  ['required-query-with-repaired-candidate', doc => {
    doc.templates[0].template += '{?per_page}';
    doc.templates[0].required.push('per_page');
    for (const request of doc.requests) if (request.template === 'repository') request.variables.per_page = '1';
  }, 'blocked'],
  ['type-contract', doc => { doc.templates[0].types.owner = 'list'; }, 'blocked'],
  ['aggregate-budget', doc => { doc.maxTotalOutputBytes = 1; }, 'blocked'],
  ['destination-change', doc => {
    doc.templates[0].template = 'https://example.com/repos/{owner}/{repo}';
  }, 'blocked'],
];
const baseline = readFileSync(new URL('../integrations/github-audit/requests.json', import.meta.url), 'utf8');
const upgrades = upgradeCases.map(([name, mutate, expected]) => {
  const doc = structuredClone(original); mutate(doc);
  const candidate = JSON.stringify(doc, null, 2) + '\n';
  const result = reviewUpgrade(baseline, candidate, { beforeFile: 'requests.json', afterFile: `<intentional-upgrade:${name}>` });
  if (result.status !== expected || result.networkCalls !== 0) throw new Error('Upgrade review failed: ' + name);
  return { name, expected, result };
});
writeFileSync(new URL('../reports/integration-upgrades.json', import.meta.url), JSON.stringify({
  status: 'passed', evidence: 'intentional-upgrade-rehearsal', generatedAt: new Date().toISOString(),
  engineSha256: sha(readFileSync(new URL('../dist/engine.mjs', import.meta.url))),
  reviewerSha256: sha(readFileSync(new URL('../integrations/github-audit/upgrade.mjs', import.meta.url))),
  contractsSha256: sha(readFileSync(new URL('../integrations/github-audit/contracts.mjs', import.meta.url))),
  manifestSha256: sha(Buffer.from(baseline)), results: upgrades,
}, null, 2) + '\n');
console.log('Six offline upgrade rehearsals passed; no HTTP and no files applied.');
