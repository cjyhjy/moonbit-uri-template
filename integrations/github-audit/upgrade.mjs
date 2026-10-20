import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProjectFile, checkProject } from '../../tools/project.mjs';
import { readCatalogDocument, prepareAudit, planRequests, destinationProblems } from './contracts.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const canonical = x => JSON.stringify(normalize(x));
function normalize(x) {
  if (Array.isArray(x)) return x.map(normalize);
  if (x !== null && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, normalize(x[k])]));
  return x;
}
const summary = check => ({
  ok: check.ok, diagnostics: check.diagnostics, totalOutputBytes: check.totalOutputBytes,
});

function inspectPlan(doc, catalog, checks) {
  const result = { checks: summary(checks), ok: false, destinations: [] };
  try {
    result.inspection = catalog.inspect(doc.requests, { maxTotalInputCodepoints: doc.maxTotalInputCodepoints ?? 4194304 });
    if (!checks.ok || !result.inspection.ok) return result;
    const plan = planRequests(doc, catalog);
    result.destinations = destinationProblems(plan.outputs);
    result.ok = plan.ok && result.destinations.length === 0;
    result.totalOutputBytes = plan.totalOutputBytes;
  } catch (error) {
    result.error = { code: error.code ?? 'InvalidInput', message: error.message,
      index: error.index, templateName: error.templateName };
  }
  return result;
}

export function reviewUpgrade(beforeText, afterText, { beforeFile = 'before.json', afterFile = 'after.json' } = {}) {
  const report = {
    schemaVersion: 1, evidence: 'offline-upgrade-review', executionPath: 'typed-catalog-sdk',
    baselineSha256: sha(beforeText), candidateSha256: sha(afterText),
    status: 'invalid-baseline', requiresReview: true, networkCalls: 0,
    note: 'Review evidence, not an automatic compatibility certificate or applied upgrade.',
  };
  const baseline = prepareAudit(beforeText, beforeFile);
  report.baseline = { checks: summary(baseline.checks), error: baseline.error };
  if (!baseline.ok) return report;
  report.baseline.destinations = destinationProblems(baseline.outputs);
  if (report.baseline.destinations.length) return report;
  const candidateChecks = checkProject(afterText, afterFile, { materialize: false });
  report.candidate = { checks: summary(candidateChecks) };
  let before, after;
  try {
    before = readCatalogDocument(beforeText, beforeFile);
    after = readCatalogDocument(afterText, afterFile);
  } catch (error) {
    report.status = 'invalid-candidate';
    report.candidate.error = { code: error.code ?? 'InvalidInput', message: error.message };
    return report;
  }
  report.catalog = before.catalog.compare(after.catalog);
  const oldEntries = new Map(before.doc.templates.map(e => [e.name, e]));
  report.typeChanges = after.doc.templates.filter(e => oldEntries.has(e.name) &&
    canonical(e.types ?? {}) !== canonical(oldEntries.get(e.name).types ?? {}))
    .map(e => ({ template: e.name, before: oldEntries.get(e.name).types ?? {}, after: e.types ?? {} }));
  report.batchBudgetChanges = [['maxTotalInputCodepoints', 4194304], ['maxTotalOutputBytes', 1048576]]
    .flatMap(([name, fallback]) => {
      const old = before.doc[name] ?? fallback, current = after.doc[name] ?? fallback;
      return old === current ? [] : [{ name, before: old, after: current, tightened: current < old }];
    });
  // Compare by request index (the manifest's execution order). Never serialize
  // binding values or generated URLs into this review report.
  report.requestChanges = [];
  for (let index = 0; index < Math.max(before.doc.requests.length, after.doc.requests?.length ?? 0); index++) {
    const old = before.doc.requests[index], current = after.doc.requests?.[index];
    if (canonical(old) !== canonical(current)) report.requestChanges.push({
      index, kind: old === undefined ? 'added' : current === undefined ? 'removed' : 'changed',
      beforeTemplate: old?.template, afterTemplate: current?.template,
    });
  }
  report.candidate = inspectPlan(after.doc, after.catalog, candidateChecks);
  const retained = { ...after.doc, requests: before.doc.requests };
  // Locations here refer to the generated rehearsal document, not to either
  // original file. Original candidate diagnostics above keep real file positions.
  report.existingRequests = inspectPlan(retained, after.catalog,
    checkProject(JSON.stringify(retained, null, 2), '<existing-requests-with-candidate-definitions>', { materialize: false }));
  report.requiresReview = report.catalog.requiresReview || report.typeChanges.length > 0 ||
    report.batchBudgetChanges.length > 0 || report.requestChanges.length > 0 ||
    !report.candidate.ok || !report.existingRequests.ok;
  report.status = !report.candidate.ok || !report.existingRequests.ok ? 'blocked' :
    report.requiresReview ? 'review-required' : 'unchanged';
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  const [beforeFile, afterFile, ...extra] = process.argv.slice(2);
  if (!beforeFile || !afterFile || extra.length) {
    console.error('Usage: node upgrade.mjs BEFORE.json CANDIDATE.json');
    process.exitCode = 2;
  } else {
    try { report = reviewUpgrade(readProjectFile(beforeFile), readProjectFile(afterFile), { beforeFile, afterFile }); }
    catch { report = { status: 'input-error', error: { code: 'FileError', message: 'cannot read manifests within UTF-8/size limits' } }; }
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'unchanged' ? 0 : ['blocked', 'review-required'].includes(report.status) ? 1 : 2;
  }
}
