// OpenAPI semantics are implemented by the MoonBit openapi package.
// This layer owns JS object lifetimes and marshals values to the existing SDK.
import { compileTemplate, UriTemplateError } from './index.mjs';
import { openapi_analyze, openapi_name, openapi_prepare, openapi_report, openapi_bindings, openapi_contract } from '../dist/engine.mjs';
function unwrap(source) {
  const result = JSON.parse(source);
  if (result.error) throw new UriTemplateError(result.error);
  return result.output;
}
const pointer = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
function hasUnpairedSurrogate(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}
function unpairedSurrogatePath(value, path = '') {
  if (typeof value === 'string') return hasUnpairedSurrogate(value) ? path : null;
  if (value === null || typeof value !== 'object') return null;
  for (const key of Object.keys(value)) {
    const child = path + '/' + pointer(key);
    if (hasUnpairedSurrogate(key)) return child;
    const found = unpairedSurrogatePath(value[key], child);
    if (found !== null) return found;
  }
  return null;
}
function unicodeFailure(source) {
  let value;
  try { value = JSON.parse(source); } catch { return null; }
  const path = unpairedSurrogatePath(value);
  if (path === null) return null;
  return {
    schemaVersion: 2,
    ok: false,
    complete: false,
    operations: [],
    diagnostics: [{ code: 'InvalidInput', severity: 'error', message: 'string contains an unpaired UTF-16 surrogate', path }],
    truncated: { errors: 0, warnings: 0 },
  };
}
function analyzeSource(source) {
  const result = JSON.parse(openapi_analyze(source));
  if (!result.error) return result.output;
  if (result.error.code === 'InvalidJson') {
    const report = unicodeFailure(source);
    if (report !== null) return report;
  }
  throw new UriTemplateError(result.error);
}
export function templateName(name) { return openapi_name(name); }
export function analyzeOpenApi(doc) {
  const result = analyzeSource(JSON.stringify(doc) ?? 'null');
  for (const op of result.operations) {
    op.parameters.forEach(Object.freeze);
    op.unsupported.forEach(Object.freeze);
  }
  return result;
}

const clientKey = Symbol('openapi');
export class OpenApiTemplates {
  #operations; #byKey; #compiled = new Map(); #base; #handle;
  constructor(key, analysis, baseUrl, handle) {
    if (key !== clientKey) throw new UriTemplateError({ code: 'InvalidInput', message: 'use compileOpenApi()' });
    this.#operations = Object.freeze(analysis.operations.map(op => Object.freeze({ ...op, parameters: Object.freeze(op.parameters), unsupported: Object.freeze(op.unsupported) })));
    this.#byKey = new Map();
    const register = (key, op) => {
      // null is a permanent ambiguity marker; an operation's own alias is safe.
      if (!this.#byKey.has(key)) this.#byKey.set(key, op);
      else if (this.#byKey.get(key) !== op) this.#byKey.set(key, null);
    };
    for (const op of this.#operations) {
      register(`${op.method} ${op.path}`, op);
      if (op.id !== null) register(op.id, op);
    }
    this.diagnostics = Object.freeze(analysis.diagnostics);
    this.#base = baseUrl;
    this.#handle = handle;
    Object.freeze(this);
  }
  get operations() { return this.#operations; }
  get(key) {
    const op = this.#byKey.get(key);
    // Let the MoonBit lookup provide the canonical ambiguity error.
    if (op === null) unwrap(openapi_contract(this.#handle, key));
    if (!op) throw new UriTemplateError({ code: 'UnknownOperation', message: `no operation ${key}` });
    return op;
  }
  expand(key, variables = {}) {
    const op = this.get(key);
    if (op.template === null) unwrap(openapi_contract(this.#handle, key));
    if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) throw new UriTemplateError({ code: 'InvalidInput', message: 'variables must be an object' });
    // Enumerate once, preserving the existing JS getter/undefined semantics.
    const entries = Object.entries(variables), captured = new Map(entries);
    const selected = unwrap(openapi_bindings(this.#handle, key, JSON.stringify(entries.map(([name, value]) => [name, value !== undefined]))));
    const vars = {};
    for (const [name, variable] of selected) vars[variable] = captured.get(name);
    return this.#base + this.#template(op, key).expand(vars);
  }
  #template(op, key) {
    let compiled = this.#compiled.get(op);
    if (!compiled) {
      const options = unwrap(openapi_contract(this.#handle, key));
      compiled = compileTemplate(op.template, options);
      this.#compiled.set(op, compiled);
    }
    return compiled;
  }
}

export function compileOpenApi(spec, { baseUrl = '', strict = false } = {}) {
  let doc = spec;
  if (typeof spec === 'string') {
    try { doc = JSON.parse(spec); } catch { throw new UriTemplateError({ code: 'InvalidJson', message: 'OpenAPI document is not valid JSON' }); }
  }
  if (typeof baseUrl !== 'string') throw new UriTemplateError({ code: 'InvalidInput', message: 'baseUrl must be a string' });
  const source = JSON.stringify(doc) ?? 'null';
  const prepared = openapi_prepare(source, baseUrl, !!strict);
  let analysis;
  const response = JSON.parse(openapi_report(prepared));
  if (response.error?.code === 'InvalidJson') {
    const report = unicodeFailure(source);
    if (report !== null) {
      const error = new UriTemplateError({ code: 'OpenApiInvalid', message: report.diagnostics[0].message, path: report.diagnostics[0].path });
      error.diagnostics = report.diagnostics;
      throw error;
    }
  }
  if (response.error) throw new UriTemplateError(response.error);
  analysis = response.output;
  for (const op of analysis.operations) {
    op.parameters.forEach(Object.freeze);
    op.unsupported.forEach(Object.freeze);
  }
  return new OpenApiTemplates(clientKey, analysis, baseUrl.replace(/\/+$/, ''), prepared);
}
