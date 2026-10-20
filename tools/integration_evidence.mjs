import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runAudit } from '../integrations/github-audit/main.mjs';
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
