// OpenAPI 3.0/3.1 operations as RFC 6570 templates, following OAS 3.1.1 Appendix C.
// Expansion goes through the compiled MoonBit core; nothing here encodes values.
import { compileTemplate, UriTemplateError } from './index.mjs';

const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const ptr = x => x.replaceAll('~', '~0').replaceAll('/', '~1');
const methods = ['get','put','post','delete','options','head','patch','trace'];
const MAX_DIAGNOSTICS = 256;
const PATH_OPERATORS = { simple: '', label: '.', matrix: ';' };

// Appendix C.3: names outside the RFC 6570 varname syntax MUST be percent-encoded.
export function templateName(name) {
  if (/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(name)) return name;
  return Array.from(new TextEncoder().encode(name), b =>
    /[A-Za-z0-9_]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

function shapeOfValue(value) {
  if (value === null || value === undefined) return null;
  const scalar = x => ['string', 'number', 'boolean'].includes(typeof x);
  if (scalar(value)) return 'scalar';
  if (Array.isArray(value)) return value.every(scalar) ? 'list' : 'nested';
  if (obj(value)) return Object.values(value).every(scalar) ? 'assoc' : 'nested';
  return 'nested';
}
const SCHEMA_SHAPES = { array: 'list', object: 'assoc', string: 'scalar', integer: 'scalar', number: 'scalar', boolean: 'scalar' };
const SHAPE_WORDS = { scalar: 'a scalar', list: 'a list', assoc: 'an object' };

export function analyzeOpenApi(doc) {
  const diagnostics = [], operations = [], counts = { error: 0, warning: 0 }, reported = new Set();
  let complete = true;
  const add = (code, message, path = '', { severity = 'error', incomplete = false, once = false } = {}) => {
    if (incomplete) complete = false;
    if (once) { const key = code + ' ' + path; if (reported.has(key)) return; reported.add(key); }
    if (counts[severity]++ >= MAX_DIAGNOSTICS) { if (severity === 'error') complete = false; return; }
    diagnostics.push({ code, severity, message, path });
  };
  const finish = () => ({ schemaVersion: 2, ok: counts.error === 0, complete, operations, diagnostics,
    truncated: { errors: Math.max(0, counts.error - MAX_DIAGNOSTICS), warnings: Math.max(0, counts.warning - MAX_DIAGNOSTICS) } });
  if (!obj(doc) || !/^3\.(0|1)\.\d+$/.test(doc.openapi ?? '')) { add('UnsupportedVersion', 'expected OpenAPI 3.0.x or 3.1.x', '/openapi', { incomplete: true }); return finish(); }
  // 3.1 documents may describe only webhooks or components.
  if (doc.paths === undefined && doc.openapi.startsWith('3.1.')) return finish();
  if (!obj(doc.paths)) { add('InvalidPaths', 'paths must be an object', '/paths', { incomplete: true }); return finish(); }

  // Returns {value, pointer} for the reference target, or null. Quiet lookups (schemas,
  // examples) are hints only and never make the report incomplete.
  function resolve(value, path, quiet = false) {
    const seen = new Set();
    let pointer = path;
    const fail = (code, message) => { if (!quiet) add(code, message, path, { incomplete: true }); return null; };
    while (obj(value) && Object.hasOwn(value, '$ref')) {
      const ref = value.$ref;
      if (typeof ref !== 'string' || !ref.startsWith('#/')) return fail('UnsupportedReference', 'only local JSON Pointer references are supported');
      // Path Item siblings have undefined merge semantics; never guess.
      if (!quiet && Object.keys(value).some(k => !['$ref', 'summary', 'description'].includes(k))) return fail('ReferenceSiblings', 'reference siblings need review');
      if (seen.has(ref) || seen.size >= 32) return fail('ReferenceCycle', 'cyclic or excessive reference chain');
      seen.add(ref);
      let parts;
      try {
        pointer = decodeURIComponent(ref.slice(1));
        parts = pointer.slice(1).split('/').map(x => {
          if (/~(?![01])/u.test(x)) throw Error();
          return x.replaceAll('~1', '/').replaceAll('~0', '~');
        });
      } catch { return fail('InvalidReference', 'invalid JSON Pointer'); }
      value = doc;
      for (const part of parts) { if (!obj(value) && !Array.isArray(value) || !Object.hasOwn(value, part)) { value = undefined; break; } value = value[part]; }
      if (value === undefined) return fail('UnresolvedReference', 'reference target does not exist');
    }
    if (!obj(value)) return quiet ? null : (add('InvalidObject', 'expected an object', path, { incomplete: true }), null);
    return { value, pointer };
  }
  function schemaShape(schema, path) {
    const found = resolve(schema, path, true);
    if (!found) return null;
    const s = found.value;
    if (s.oneOf || s.anyOf || s.allOf || s.not) return null;
    const types = (Array.isArray(s.type) ? s.type : [s.type]).filter(t => t !== 'null');
    const shapes = new Set(types.map(t => SCHEMA_SHAPES[t]));
    return shapes.size === 1 && !shapes.has(undefined) ? [...shapes][0] : null;
  }
  // The first example in document order: parameter, its examples map, then its schema.
  function exampleOf(p, pointer) {
    if (Object.hasOwn(p, 'example')) return { value: p.example, pointer: pointer + '/example' };
    if (obj(p.examples)) for (const [key, raw] of Object.entries(p.examples)) {
      const found = resolve(raw, pointer + '/examples/' + ptr(key), true);
      if (found && Object.hasOwn(found.value, 'value')) return { value: found.value.value, pointer: found.pointer + '/value' };
    }
    const schema = resolve(p.schema, pointer + '/schema', true);
    if (schema && Object.hasOwn(schema.value, 'example')) return { value: schema.value.example, pointer: schema.pointer + '/example' };
    if (schema && Array.isArray(schema.value.examples) && schema.value.examples.length) return { value: schema.value.examples[0], pointer: schema.pointer + '/examples/0' };
    return null;
  }
  function parameters(value, path, names) {
    const result = new Map();
    if (value === undefined) return result;
    if (!Array.isArray(value)) { add('InvalidParameters', 'parameters must be an array', path, { incomplete: true }); return result; }
    for (const [i, raw] of value.entries()) {
      const where = `${path}/${i}`, found = resolve(raw, where);
      if (!found) continue;
      const p = found.value;
      if (typeof p.name !== 'string' || !p.name || !['path', 'query', 'header', 'cookie'].includes(p.in)) { add('InvalidParameter', 'parameter requires name and valid in', where); continue; }
      const key = JSON.stringify([p.in, p.name]);
      if (result.has(key)) add('DuplicateParameter', 'duplicate name and location in the same parameter list', where);
      result.set(key, { p, pointer: found.pointer });
      if (p.in === 'path') {
        if (p.required !== true) add('PathParameterRequired', 'path parameter must set required: true', where);
        if (!names.includes(p.name)) add('UnusedPathParameter', `path does not contain parameter ${p.name}`, where);
      }
    }
    return result;
  }

  const shapes = new Map(), ids = new Map();
  for (const [path, raw] of Object.entries(doc.paths)) {
    if (path.startsWith('x-')) continue;
    const where = '/paths/' + ptr(path);
    if (!path.startsWith('/')) { add('InvalidPath', 'path must start with /', where); continue; }
    const names = [], aliases = new Map();
    // OAS names need not satisfy RFC 6570 varname grammar. Use opaque aliases.
    const normalized = path.replace(/\{([^{}]+)\}/g, (_, name) => {
      if (!aliases.has(name)) { aliases.set(name, 'v' + names.length); names.push(name); }
      return '{' + aliases.get(name) + '}';
    });
    const literal = path.replace(/\{[^{}]+\}/g, '');
    if (/[{}]/.test(literal)) { add('InvalidPathTemplate', 'unbalanced or empty path placeholder', where); continue; }
    // RFC 6570 literals admit more than RFC 3986 pchar (e.g. [ ] and non-ASCII); OAS paths use pchar.
    const bad = literal.replace(/%[0-9A-Fa-f]{2}/g, '').match(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/]/u)?.[0];
    if (bad === '?') { add('InvalidPath', 'path contains a query string; declare query parameters instead', where); continue; }
    if (bad === '#') { add('InvalidPath', 'path contains a fragment, which is never sent to the server', where); continue; }
    if (bad) { add('InvalidPath', `path literal contains ${JSON.stringify(bad)}; percent-encode it`, where); continue; }
    let core;
    // Non-strict parsing admits the apostrophe, which OAS path literals allow.
    try { core = compileTemplate(normalized); } catch (e) { add('InvalidPathTemplate', e.message, where); continue; }
    const shape = normalized.replace(/\{v\d+\}/g, '{}');
    if (shapes.has(shape)) add('EquivalentPaths', `same path hierarchy as ${shapes.get(shape)}`, where);
    else shapes.set(shape, path);
    const item = resolve(raw, where)?.value;
    if (!item) continue;
    const base = parameters(item.parameters, where + '/parameters', names);
    // A Path Item without operations (e.g. filtered by ACL) needs no path parameters.
    for (const method of methods.filter(m => Object.hasOwn(item, m))) {
      const opWhere = where + '/' + method, op = item[method];
      if (!obj(op)) { add('InvalidOperation', 'operation must be an object', opWhere); continue; }
      const effective = new Map([...base, ...parameters(op.parameters, opWhere + '/parameters', names)]);
      let missing = false;
      for (const alias of core.variables) {
        const name = names[Number(alias.slice(1))];
        if (!effective.has(JSON.stringify(['path', name]))) { add('MissingPathParameter', `missing path parameter ${name}`, opWhere); missing = true; }
      }
      const id = typeof op.operationId === 'string' ? op.operationId : null;
      if (id !== null) {
        if (ids.has(id)) add('DuplicateOperationId', `operationId ${id} is also used by ${ids.get(id)}`, opWhere + '/operationId');
        else ids.set(id, `${method.toUpperCase()} ${path}`);
      }
      operations.push(operation(id, method, path, names, effective, missing));
    }
  }
  return finish();

  function operation(id, method, path, names, effective, missing) {
    const params = [], unsupported = [], pathVars = new Map(), query = [], example = {};
    const pathNames = new Set(names.map(templateName));
    let exampleComplete = true;
    for (const { p, pointer } of effective.values()) {
      const shape = schemaShape(p.schema, pointer + '/schema');
      const entry = { name: p.name, in: p.in, required: p.required === true, shape, variable: null };
      params.push(entry);
      if (p.in === 'header' || p.in === 'cookie') continue;
      const style = p.style ?? (p.in === 'path' ? 'simple' : 'form');
      const explode = p.explode ?? style === 'form';
      let reason = null;
      if (p.content !== undefined) reason = 'content-based serialization has no RFC 6570 equivalent';
      else if (p.in === 'path' && !(style in PATH_OPERATORS)) reason = `style ${style} is not defined for path parameters`;
      else if (p.in === 'query' && style !== 'form') reason = `style ${style} has no RFC 6570 equivalent`;
      else if (p.in === 'query' && p.allowReserved === true) reason = 'form style with allowReserved has no RFC 6570 equivalent';
      const variable = templateName(p.name);
      if (!reason && p.in === 'path' && !names.includes(p.name)) reason = 'the path does not contain this parameter';
      if (!reason && p.in === 'query' && pathNames.has(variable)) reason = 'name is also used by a path parameter';
      if (reason) { unsupported.push({ name: p.name, in: p.in, reason }); continue; }
      entry.variable = variable;
      // explode does not change a scalar's expansion; leaving * off keeps templates readable.
      const spec = variable + (explode && shape !== 'scalar' ? '*' : '');
      if (p.in === 'path') pathVars.set(variable, (PATH_OPERATORS[style]) + spec);
      else query.push(spec);
      const sample = exampleOf(p, pointer);
      const actual = sample && shapeOfValue(sample.value);
      if (actual === 'nested') add('ExampleNotSerializable', `example for ${p.in} parameter ${p.name} nests values deeper than RFC 6570 defines`, sample.pointer, { severity: 'warning', once: true });
      else if (actual && shape && actual !== shape) add('ExampleShapeMismatch', `example for ${p.in} parameter ${p.name} is ${SHAPE_WORDS[actual]} but its schema is ${SHAPE_WORDS[shape]}`, sample.pointer, { severity: 'warning', once: true });
      else if (actual) example[variable] = sample.value;
      if (p.in === 'path' && !(variable in example)) exampleComplete = false;
    }
    const pathUnsupported = unsupported.some(u => u.in === 'path' && names.includes(u.name));
    let template = null, exampleUri = null;
    if (!missing && !pathUnsupported) {
      // Appendix C.1: all form parameters form one {?...} expression.
      template = path.replace(/\{([^{}]+)\}/g, (_, name) => '{' + pathVars.get(templateName(name)) + '}') +
        (query.length ? '{?' + query.join(',') + '}' : '');
      if (exampleComplete) {
        try { exampleUri = compileTemplate(template).expand(example); }
        catch (e) { if (!(e instanceof UriTemplateError)) throw e; }
      }
    }
    return { id, method: method.toUpperCase(), path, template, parameters: params.map(Object.freeze), unsupported: unsupported.map(Object.freeze), example: exampleUri };
  }
}

const clientKey = Symbol('openapi');
export class OpenApiTemplates {
  #operations; #byKey; #compiled = new Map(); #base;
  constructor(key, analysis, baseUrl) {
    if (key !== clientKey) throw new UriTemplateError({ code: 'InvalidInput', message: 'use compileOpenApi()' });
    this.#operations = Object.freeze(analysis.operations.map(op => Object.freeze({ ...op, parameters: Object.freeze(op.parameters), unsupported: Object.freeze(op.unsupported) })));
    this.#byKey = new Map();
    for (const op of this.#operations) {
      this.#byKey.set(`${op.method} ${op.path}`, op);
      if (op.id !== null && !this.#byKey.has(op.id)) this.#byKey.set(op.id, op);
    }
    this.diagnostics = Object.freeze(analysis.diagnostics);
    this.#base = baseUrl;
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
    if (op.template === null) throw new UriTemplateError({ code: 'UnsupportedOperation', message: `${key} has no RFC 6570 template: ` + (op.unsupported.map(u => `${u.name} (${u.reason})`).join('; ') || 'its path parameters are not declared') });
    if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) throw new UriTemplateError({ code: 'InvalidInput', message: 'variables must be an object' });
    const vars = {};
    for (const [name, value] of Object.entries(variables)) {
      const param = op.parameters.find(p => p.name === name);
      const blocked = op.unsupported.find(u => u.name === name);
      if (blocked && value !== undefined) throw new UriTemplateError({ code: 'UnsupportedParameter', message: `${name}: ${blocked.reason}`, path: '/' + ptr(name) });
      if (!param) throw new UriTemplateError({ code: 'UnknownParameter', message: `${key} has no parameter ${name}`, path: '/' + ptr(name) });
      // Header and cookie parameters belong to the request, not the URI.
      if (param.variable !== null) vars[param.variable] = value;
    }
    return this.#base + this.#template(op).expand(vars);
  }
  #template(op) {
    let compiled = this.#compiled.get(op);
    if (!compiled) {
      const urlParams = op.parameters.filter(p => p.variable !== null);
      compiled = compileTemplate(op.template, {
        required: [...new Set(urlParams.filter(p => p.required).map(p => p.variable))],
        types: Object.fromEntries(urlParams.filter(p => p.shape).map(p => [p.variable, p.shape])),
      });
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
  const analysis = analyzeOpenApi(doc);
  const errors = analysis.diagnostics.filter(d => d.severity === 'error');
  if (!analysis.complete || (strict && errors.length)) {
    const error = new UriTemplateError({ code: 'OpenApiInvalid', message: (errors[0] ?? analysis.diagnostics[0])?.message ?? 'OpenAPI document is incomplete', path: (errors[0] ?? analysis.diagnostics[0])?.path ?? '' });
    error.diagnostics = analysis.diagnostics;
    throw error;
  }
  return new OpenApiTemplates(clientKey, analysis, baseUrl.replace(/\/+$/, ''));
}
