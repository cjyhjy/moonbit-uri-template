import { prepare_request, prepared_call, prepared_compare } from './engine.mjs';
import { parseSource } from './json-source.mjs';
import { locate } from './diagnostics.mjs';

function decorate(response, source, target, parsed) {
  if (!response.error) return response;
  const error = response.error;
  const token = error.path !== undefined ? parsed?.nodes.get(error.path) : undefined;
  if (token) return { ...response, error: { ...error, location: { target: 'vars', start: token.start, end: token.end } } };
  if (Number.isInteger(error.start)) {
    const located = locate(source, error);
    return { ...response, error: { ...located, location: { target, start: located.utf16Start, end: located.utf16End } } };
  }
  return { ...response, error: { ...error, target } };
}
function prepare(source, options, target, variables, parsed) {
  const handle = prepare_request(source, JSON.stringify(options));
  const call = command => decorate(JSON.parse(prepared_call(handle, command, variables)), source, target, parsed);
  const analysis = call('analyze'), check = call('check'), expansion = call('expand');
  return { handle, result: { analysis, check, expansion } };
}
export function evaluateRequest({ source, variables, options, candidate, candidateOptions, compare = false }) {
  const over = (text, limit) => { let count = 0; for (const _ of text) if (++count > limit) return true; return false; };
  if (over(source, 16384) || (compare && over(candidate, 16384)))
    return { error: { code: 'TemplateLengthLimit', message: '模板不能超过 16,384 码点。' } };
  if (over(variables, 131072))
    return { error: { code: 'JsonInputLimit', message: '变量 JSON 不能超过 131,072 码点。', target: 'vars' } };
  let parsed;
  try { parsed = parseSource(variables); }
  catch (error) {
    return { error: { code: error.code, message: error.message,
      ...(Number.isInteger(error.start) ? { location: { target: 'vars', start: error.start, end: error.end } } : { target: 'vars' }) } };
  }
  const before = prepare(source, options, 'template', variables, parsed);
  if (!compare) return { before: before.result };
  const after = prepare(candidate, candidateOptions, 'candidate', variables, parsed);
  // Keep the failing editor's source location for invalid candidate definitions.
  if (before.result.analysis.error || after.result.analysis.error)
    return { before: before.result, after: after.result, comparison: { error: before.result.analysis.error ?? after.result.analysis.error } };
  const comparison = JSON.parse(prepared_compare(before.handle, after.handle));
  return { before: before.result, after: after.result, comparison };
}
