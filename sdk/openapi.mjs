// OpenAPI semantics are implemented by the MoonBit openapi package.
// This layer owns JS object lifetimes and marshals values to the existing SDK.
import { compileTemplate, UriTemplateError } from './index.mjs';
import { openapi_analyze, openapi_name, openapi_prepare, openapi_report, openapi_bindings, openapi_contract } from '../dist/engine.mjs';
function unwrap(source) {
  const result = JSON.parse(source);
  if (result.error) throw new UriTemplateError(result.error);
  return result.output;
}
export function templateName(name) { return openapi_name(name); }
export function analyzeOpenApi(doc) {
  const result = unwrap(openapi_analyze(JSON.stringify(doc) ?? 'null'));
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
    for (const op of this.#operations) {
      this.#byKey.set(`${op.method} ${op.path}`, op);
      if (op.id !== null && !this.#byKey.has(op.id)) this.#byKey.set(op.id, op);
    }
    this.diagnostics = Object.freeze(analysis.diagnostics);
    this.#base = baseUrl;
    this.#handle = handle;
    Object.freeze(this);
  }
  get operations() { return this.#operations; }
  get(key) {
    const op = this.#byKey.get(key);
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
    return this.#base + this.#template(op).expand(vars);
  }
  #template(op) {
    let compiled = this.#compiled.get(op);
    if (!compiled) {
      const options = unwrap(openapi_contract(this.#handle, `${op.method} ${op.path}`));
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
  const prepared = openapi_prepare(JSON.stringify(doc) ?? 'null', baseUrl, !!strict);
  const analysis = unwrap(openapi_report(prepared));
  for (const op of analysis.operations) {
    op.parameters.forEach(Object.freeze);
    op.unsupported.forEach(Object.freeze);
  }
  return new OpenApiTemplates(clientKey, analysis, baseUrl.replace(/\/+$/, ''), prepared);
}
