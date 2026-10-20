import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRequest } from '../dist/playground/compute.mjs';
import { createRunner } from '../dist/playground/controller.mjs';
const job = () => ({ source: '/users/{id}{?page}', variables: '{"id":"team/a"}',
  options: { strict: true, required: ['id'], maxOutput: 8192 } });

test('workbench analyzes references while preserving optional omission semantics', () => {
  const r = evaluateRequest(job()).before;
  assert.equal(r.expansion.output, '/users/team%2Fa');
  assert.deepEqual(JSON.parse(r.analysis.output).profiles.map(p => p.name), ['id', 'page']);
  assert.deepEqual(JSON.parse(r.check.output).missing.map(v => v.name), ['page']);
});
test('workbench reports candidate-only contracts and same bindings independently', () => {
  const input = { ...job(), compare: true, candidate: '/users/{+id:3}{?page}',
    candidateOptions: { strict: true, required: ['id','page'], maxOutput: 128 } };
  const r = evaluateRequest(input), c = JSON.parse(r.comparison.output);
  assert.equal(r.before.expansion.exitCode, 0);
  assert.equal(r.after.expansion.error.code, 'MissingBinding');
  assert.equal(r.after.expansion.error.location.target, 'candidate');
  assert.deepEqual(c.addedRequired, ['page']);
  assert.equal(c.reservedAdded, true);
  assert.equal(c.variableChanges[0].prefixesChanged, true);
  assert.equal(c.budgetChanges[0].tightened, true);
  const unchanged = evaluateRequest({ ...job(), compare: true, candidate: job().source, candidateOptions: job().options });
  assert.equal(JSON.parse(unchanged.comparison.output).requiresReview, false);
});
test('workbench selection offsets address Unicode template and JSON editors correctly', () => {
  const source = '中文😀/{id', r = evaluateRequest({ ...job(), source }).before.expansion;
  assert.equal(r.error.location.target, 'template');
  assert.equal(source.slice(r.error.location.start, r.error.location.end), '{id');
  const variables = '{"id":42}', wrong = evaluateRequest({ ...job(), variables }).before.expansion.error;
  assert.equal(wrong.location.target, 'vars');
  assert.equal(variables.slice(wrong.location.start, wrong.location.end), '42');
  const candidate = '😀/{bad', c = evaluateRequest({ ...job(), compare: true, candidate, candidateOptions: {} });
  assert.equal(c.comparison.error.location.target, 'candidate');
  assert.equal(candidate.slice(c.comparison.error.location.start, c.comparison.error.location.end), '{bad');
});
test('workbench rejects duplicate JSON and excessive input before core analysis', () => {
  const variables = '{"id":"😀","i\\u0064":"b"}';
  const error = evaluateRequest({ ...job(), variables }).error;
  assert.equal(error.code, 'DuplicateJsonKey');
  assert.equal(variables.slice(error.location.start, error.location.end), '"i\\u0064"');
  assert.equal(evaluateRequest({ ...job(), source: 'a'.repeat(16385) }).error.code, 'TemplateLengthLimit');
  assert.equal(evaluateRequest({ ...job(), variables: ' '.repeat(131073) }).error.code, 'JsonInputLimit');
});
function harness() {
  const workers = [], timers = [], results = [], errors = [];
  const runner = createRunner({
    createWorker: () => { const w = { terminate() { this.terminated = true; }, postMessage(m) { this.sent = m; } }; workers.push(w); return w; },
    setTimer: fn => { timers.push(fn); return timers.length - 1; }, clearTimer: () => {},
    onPending: () => {}, onResult: r => results.push(r), onError: e => errors.push(e),
  });
  return { runner, workers, timers, results, errors };
}
test('workbench cancellation and superseded messages cannot restore stale results', () => {
  const h = harness();
  h.runner.run({ version: 1 }); const first = h.workers[0];
  h.runner.cancel(); first.onmessage({ data: { id: first.sent.id, result: 'stale' } }); h.timers[0]();
  assert.equal(first.terminated, true);
  h.runner.run({ version: 2 }); const second = h.workers[1];
  first.onerror(); first.onmessage({ data: { id: first.sent.id, result: 'still stale' } });
  second.onmessage({ data: { id: second.sent.id, result: 'current' } }); h.timers[1]();
  assert.deepEqual(h.results, ['current']); assert.deepEqual(h.errors, []);
  assert.equal(second.terminated, true);
});
test('workbench timeout and worker startup failures stop computation and allow retry', () => {
  const h = harness(); h.runner.run({});
  h.timers[0]();
  assert.equal(h.errors[0].code, 'TimeLimit'); assert.equal(h.workers[0].terminated, true);
  h.workers[0].onmessage({ data: { id: h.workers[0].sent.id, result: 'too late' } });
  assert.deepEqual(h.results, []);
  h.runner.run({}); h.workers[1].onmessage({ data: { id: h.workers[1].sent.id, result: 'retry' } });
  assert.deepEqual(h.results, ['retry']);
  let code;
  createRunner({ createWorker: () => { throw Error('startup'); }, onPending: () => {},
    onResult: () => assert.fail(), onError: e => { code = e.code; } }).run({});
  assert.equal(code, 'WorkerError');
});
