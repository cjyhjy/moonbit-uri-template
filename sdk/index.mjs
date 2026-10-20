import { prepare_request, prepared_call } from '../dist/engine.mjs';
import { locate } from '../tools/diagnostics.mjs';

export class UriTemplateError extends Error {
  constructor(detail, source = '') {
    super(detail.message);
    this.name = 'UriTemplateError';
    Object.assign(this, locate(source, detail));
  }
}
const invalid = (message, path = '') => new UriTemplateError({ code: 'InvalidInput', message, path });
const plain = x => x !== null && typeof x === 'object' &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);

// Reject values JSON.stringify would silently omit or transform. No user getters
// or toJSON hooks are invoked; input snapshots cannot mutate between batch passes.
function jsonSnapshot(value, options = false) {
  const seen = new Set();
  let remaining = options ? 65536 : 4194304, nodes = options ? 65536 : 262144;
  const count = text => {
    for (const _ of text) if (--remaining < 0)
      throw new UriTemplateError({ code: 'JsonInputLimit', message: 'SDK snapshot exceeds text budget' });
  };
  const copy = (x, depth, path) => {
    if (--nodes < 0) throw new UriTemplateError({ code: 'JsonInputLimit', message: 'SDK snapshot exceeds node budget' });
    if (depth > 32) throw invalid('input nesting exceeds 32 levels', path);
    if (x === null || typeof x === 'string' || (options && ['number', 'boolean'].includes(typeof x))) {
      if (typeof x === 'number' && !Number.isFinite(x)) throw invalid('number must be finite', path);
      if (typeof x === 'string') count(x);
      return x;
    }
    if (!Array.isArray(x) && !plain(x)) throw invalid('expected strings, null, arrays or plain objects', path);
    if (seen.has(x)) throw invalid('cyclic input is not supported', path);
    seen.add(x);
    const out = Array.isArray(x) ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(x)) {
      if (Array.isArray(x) && key === 'length') continue;
      if (typeof key !== 'string') throw invalid('symbol properties are not supported', path);
      count(key);
      const descriptor = Object.getOwnPropertyDescriptor(x, key);
      if (!descriptor.enumerable || !('value' in descriptor)) throw invalid('use enumerable data properties without getters', path);
      if (Array.isArray(x) && !/^(0|[1-9][0-9]*)$/.test(key)) throw invalid('array properties must be indices', path);
      out[key] = copy(descriptor.value, depth + 1, path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'));
    }
    if (Array.isArray(x) && Object.keys(out).length !== x.length) throw invalid('sparse arrays are not supported', path);
    seen.delete(x);
    return out;
  };
  if (!plain(value)) throw invalid('expected a plain object');
  return JSON.stringify(copy(value, 0, ''));
}
function result(handle, command, json, source) {
  const r = JSON.parse(prepared_call(handle, command, json));
  if (r.error) throw new UriTemplateError(r.error, source);
  return r.output;
}
function batchLimits(value = {}) {
  if (!plain(value)) throw invalid('batch limits must be an object');
  const limits = { maxItems: 256, maxTotalInputCodepoints: 4194304, maxTotalOutputBytes: 4194304 };
  const snapshot = JSON.parse(jsonSnapshot(value, true));
  for (const [key, n] of Object.entries(snapshot)) {
    if (!Object.hasOwn(limits, key) || !Number.isInteger(n) || n < 0 || n > 2147483647) throw invalid('invalid batch limit', '/' + key);
    limits[key] = n;
  }
  return limits;
}
const compileKey = Symbol('compiled');
export class CompiledTemplate {
  #handle;
  #source;
  #names;
  constructor(key, source, handle) {
    if (key !== compileKey) throw invalid('use compileTemplate()');
    this.#handle = handle;
    this.#source = source;
    this.#names = Object.freeze(JSON.parse(result(handle, 'variables', '{}', source)));
    Object.freeze(this);
  }
  get source() { return this.#source; }
  get variables() { return this.#names; }
  expand(variables = {}) { return this.#call('expand', variables); }
  measure(variables = {}) { return Number(this.#call('measure', variables)); }
  trace(variables = {}) { return JSON.parse(this.#call('trace', variables)); }
  check(variables = {}) { return JSON.parse(this.#call('check', variables)); }
  tryExpand(variables = {}) {
    try { return { ok: true, value: this.expand(variables) }; }
    catch (error) { if (!(error instanceof UriTemplateError)) throw error; return { ok: false, error }; }
  }
  #call(command, variables) {
    return result(this.#handle, command, jsonSnapshot(variables), this.#source);
  }
  expandMany(inputs, budgets) {
    if (!Array.isArray(inputs)) throw invalid('inputs must be an array');
    const limits = batchLimits(budgets);
    if (inputs.length > limits.maxItems) throw new UriTemplateError({ code: 'BatchItemLimit', message: 'batch count exceeds budget', index: -1 });
    const snapshots = [];
    let remainingInput = limits.maxTotalInputCodepoints, remainingOutput = limits.maxTotalOutputBytes;
    for (let index = 0; index < inputs.length; index++) {
      try {
        const json = jsonSnapshot(inputs[index]);
        remainingInput -= Array.from(json).length;
        if (remainingInput < 0) throw new UriTemplateError({ code: 'BatchInputLimit', message: 'serialized input exceeds batch budget' });
        const bytes = Number(result(this.#handle, 'measure', json, this.#source));
        if (bytes > remainingOutput) throw new UriTemplateError({ code: 'BatchOutputLimit', message: 'total output exceeds batch budget' });
        remainingOutput -= bytes;
        snapshots.push(json);
      } catch (error) {
        if (error instanceof UriTemplateError) error.index = index;
        throw error;
      }
    }
    return snapshots.map(json => result(this.#handle, 'expand', json, this.#source));
  }
}

export function compileTemplate(source, options = {}) {
  if (typeof source !== 'string') throw invalid('template must be a string');
  const snapshot = JSON.parse(jsonSnapshot(options, true));
  const handle = prepare_request(source, JSON.stringify({ strict: true, rejectUnused: true, ...snapshot }));
  return new CompiledTemplate(compileKey, source, handle);
}
export function expand(source, variables, options) {
  return compileTemplate(source, options).expand(variables);
}
